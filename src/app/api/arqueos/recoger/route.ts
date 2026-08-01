/**
 * POST /api/arqueos/recoger — firma la recogida de uno o VARIOS sobres.
 *
 * El responsable no pasa cada semana: cuando aparece puede haber dos o tres
 * sobres esperando en la misma tienda (ticket 6d24af90). Por eso acepta
 * `arqueoIds` y los firma todos de una vez, con un solo PIN.
 *
 * Quién firma es **`recogidoPorId`**, no quien tiene la sesión abierta: en la
 * tienda el móvil lo lleva el comercial, y quien se lleva el dinero es el
 * responsable que acaba de entrar por la puerta. Se elige de la lista de
 * autorizados y teclea su PIN ahí mismo; esa es la firma. Si no se manda, firma
 * quien esté en sesión (el caso de que el propio responsable use su móvil).
 *
 * El PIN se guarda en bcrypt, nunca en claro. Tras varios fallos seguidos se
 * bloquea la firma un rato (no la cuenta): quien recoge está físicamente en la
 * tienda y no puede quedarse fuera por teclear mal dos veces. La política vive
 * en `arqueos.ts` y está testeada aparte.
 *
 * Quien opera la pantalla solo puede firmar sobres de **sus** sedes (o de la que
 * haya confirmado hoy como centro de trabajo); administración, de todas.
 *
 * Al recoger se congela `efectivoCierres`: si mañana se corrige un cierre de esa
 * semana, lo que se firmó aquel día no cambia.
 *
 * Aquí NO se toca el saldo de la caja: el dinero salió del cajón cuando se
 * declaró el arqueo el domingo y se metió en el sobre (ahí es donde la caja
 * quedó a cero, ver POST /api/arqueos). Esto es la firma de que un responsable
 * se llevó esos sobres.
 */

import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { esDescuadre, filtroSede } from "@/lib/cierre-turno/core";
import { diferenciaSaldo } from "@/lib/cierre-turno/saldo-caja";
import { sedesOperables } from "@/lib/cierre-turno/sedes-operables";
import {
  minutosDeBloqueo,
  normalizarEfectivoArqueo,
  pinBloqueado,
  rangoSemanaISO,
  trasAciertoPin,
  trasFalloPin,
} from "@/lib/cierre-turno/arqueos";
import { totalesCajaPorSede, umbralDescuadre } from "@/lib/cierre-turno/caja-queries";
import { notifyRecogidaEfectivo } from "@/lib/cierre-turno/notify";

export const POST = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaSesion = ((session.user as any).tiendaId as string | null) ?? null;

    const body = (await req.json().catch(() => null)) as {
      arqueoId?: unknown;
      arqueoIds?: unknown;
      /** Quién se lleva el dinero. Por defecto, quien tiene la sesión. */
      recogidoPorId?: unknown;
      pin?: unknown;
      /** Si se lleva menos de lo declarado. Solo con un sobre. */
      efectivoRecogido?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

    const ids = [
      ...new Set(
        [
          ...(Array.isArray(body.arqueoIds) ? body.arqueoIds : []),
          ...(typeof body.arqueoId === "string" ? [body.arqueoId] : []),
        ].filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    ];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Elige al menos un sobre." }, { status: 400 });
    }

    const firmanteId =
      typeof body.recogidoPorId === "string" && body.recogidoPorId ? body.recogidoPorId : userId;
    const firmaOtro = firmanteId !== userId;

    const firmante = await prisma.user.findUnique({
      where: { id: firmanteId },
      select: {
        id: true,
        nombre: true,
        apellidos: true,
        activo: true,
        puedeRecogerEfectivo: true,
        pinRecogidaHash: true,
        pinRecogidaIntentos: true,
        pinRecogidaBloqueoHasta: true,
      },
    });
    if (!firmante?.activo || !firmante.puedeRecogerEfectivo) {
      return NextResponse.json(
        {
          error: firmaOtro
            ? "Esa persona no está autorizada a recoger efectivo."
            : "No estás autorizado a recoger efectivo. Lo habilita administración.",
        },
        { status: 403 },
      );
    }
    if (!firmante.pinRecogidaHash) {
      return NextResponse.json(
        {
          error: firmaOtro
            ? `${firmante.nombre} no tiene PIN de recogida. Se lo pone administración.`
            : "No tienes PIN de recogida. Pide a administración que te lo asigne.",
          code: "sin_pin",
        },
        { status: 409 },
      );
    }

    const estadoPin = {
      intentos: firmante.pinRecogidaIntentos,
      bloqueoHasta: firmante.pinRecogidaBloqueoHasta,
    };
    if (pinBloqueado(estadoPin)) {
      return NextResponse.json(
        {
          error: `Demasiados intentos. Vuelve a probar en ${minutosDeBloqueo(estadoPin)} minutos.`,
          code: "pin_bloqueado",
        },
        { status: 429 },
      );
    }

    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    if (!pin) return NextResponse.json({ error: "Escribe el PIN." }, { status: 400 });

    if (!(await bcrypt.compare(pin, firmante.pinRecogidaHash))) {
      const nuevo = trasFalloPin(estadoPin);
      await prisma.user.update({
        where: { id: firmante.id },
        data: {
          pinRecogidaIntentos: nuevo.intentos,
          pinRecogidaBloqueoHasta: nuevo.bloqueoHasta,
        },
      });
      const bloqueado = pinBloqueado(nuevo);
      return NextResponse.json(
        {
          error: bloqueado
            ? `PIN incorrecto. Se han agotado los intentos: prueba de nuevo en ${minutosDeBloqueo(nuevo)} minutos.`
            : "PIN incorrecto.",
          code: bloqueado ? "pin_bloqueado" : "pin_incorrecto",
        },
        { status: bloqueado ? 429 : 401 },
      );
    }

    const arqueos = await prisma.arqueo.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        semana: true,
        tiendaId: true,
        estado: true,
        efectivoDeclarado: true,
        saldoEsperado: true,
        tienda: { select: { id: true, nombre: true } },
      },
      orderBy: [{ tiendaId: "asc" }, { semana: "asc" }],
    });
    if (arqueos.length !== ids.length) {
      return NextResponse.json(
        { error: "Algún sobre ya no existe. Recarga la página." },
        { status: 404 },
      );
    }
    const yaRecogido = arqueos.find((a) => a.estado === "recogido");
    if (yaRecogido) {
      return NextResponse.json(
        {
          error: `El sobre de ${yaRecogido.tienda.nombre} (${yaRecogido.semana}) ya estaba recogido. Recarga la página.`,
          code: "ya_recogido",
        },
        { status: 409 },
      );
    }

    // Quien opera la pantalla solo firma sobres de sus sedes.
    const sedesPropias =
      rol === "OWNER" ? [] : await sedesOperables(prisma, { userId, tiendaId: tiendaSesion });
    const filtro = filtroSede(rol, sedesPropias, null);
    if (filtro.tipo === "ninguna") {
      return NextResponse.json(
        { error: "No tienes ninguna sede asignada, así que no puedes firmar recogidas." },
        { status: 403 },
      );
    }
    if (filtro.tipo === "sedes") {
      const fuera = arqueos.find((a) => !filtro.tiendaIds.includes(a.tiendaId));
      if (fuera) {
        return NextResponse.json(
          { error: `El sobre de ${fuera.tienda.nombre} no es de tus sedes.` },
          { status: 403 },
        );
      }
    }

    // Llevarse menos de lo declarado solo tiene sentido con un sobre: con varios
    // no se sabría a cuál aplicarlo.
    let recogidoParcial: number | null = null;
    if (
      body.efectivoRecogido !== undefined &&
      body.efectivoRecogido !== null &&
      body.efectivoRecogido !== ""
    ) {
      if (arqueos.length > 1) {
        return NextResponse.json(
          { error: "Para llevarte un importe distinto, firma ese sobre por separado." },
          { status: 400 },
        );
      }
      const v = normalizarEfectivoArqueo(body.efectivoRecogido);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      if (v.importe > Number(arqueos[0]!.efectivoDeclarado)) {
        return NextResponse.json(
          { error: "No puedes recoger más de lo que la tienda declaró." },
          { status: 400 },
        );
      }
      recogidoParcial = v.importe;
    }

    const umbral = await umbralDescuadre(prisma);

    // Con qué se comparó cada sobre, en el momento de la firma.
    const detalle = await Promise.all(
      arqueos.map(async (a) => {
        const { desde, hasta } = rangoSemanaISO(a.semana);
        const porSede = await totalesCajaPorSede(prisma, { desde, hasta, tiendaId: a.tiendaId });
        const declarado = Number(a.efectivoDeclarado);
        // Contra el acumulado con el que se declaró, que es el número que la
        // tienda tenía delante al contar el dinero (ticket 5f0a92c7). Sin saldo
        // guardado no hay diferencia que dar, en vez de inventar una.
        const esperado = a.saldoEsperado === null ? null : Number(a.saldoEsperado);
        const diferencia = diferenciaSaldo(declarado, esperado);
        return {
          arqueo: a,
          declarado,
          recogido: recogidoParcial ?? declarado,
          segunCierres: porSede.get(a.tiendaId)?.efectivo ?? 0,
          esperado,
          diferencia,
          descuadre: diferencia === null ? false : esDescuadre(diferencia, umbral),
        };
      }),
    );

    const limpio = trasAciertoPin();
    const ahora = new Date();
    await prisma.$transaction(async (tx) => {
      for (const d of detalle) {
        await tx.arqueo.update({
          where: { id: d.arqueo.id },
          data: {
            estado: "recogido",
            recogidoPorId: firmante.id,
            recogidoEn: ahora,
            efectivoRecogido: d.recogido,
            efectivoCierres: d.segunCierres,
          },
        });
      }
      await tx.user.update({
        where: { id: firmante.id },
        data: { pinRecogidaIntentos: limpio.intentos, pinRecogidaBloqueoHasta: limpio.bloqueoHasta },
      });
    });

    // Los avisos van después de guardar y sin bloquear la respuesta: perder un
    // aviso es molesto, perder la firma de una recogida es inaceptable.
    for (const d of detalle) {
      await notifyRecogidaEfectivo({
        recogidoPor: { id: firmante.id, nombre: firmante.nombre, apellidos: firmante.apellidos },
        sede: d.arqueo.tienda,
        semana: d.arqueo.semana,
        declarado: d.declarado,
        recogido: d.recogido,
        segunCierres: d.segunCierres,
        diferencia: d.diferencia ?? 0,
        descuadre: d.descuadre,
      });
    }

    const total = detalle.reduce((n, d) => n + d.recogido, 0);
    return NextResponse.json({
      ok: true,
      sobres: detalle.length,
      total: Math.round(total * 100) / 100,
      recogidoPor: `${firmante.nombre} ${firmante.apellidos}`.trim(),
      // Compatibilidad con la firma de un solo sobre.
      arqueoId: detalle[0]!.arqueo.id,
      recogido: detalle[0]!.recogido,
      segunCierres: detalle[0]!.segunCierres,
      esperado: detalle[0]!.esperado,
      diferencia: detalle[0]!.diferencia,
      descuadre: detalle.some((d) => d.descuadre),
      detalle: detalle.map((d) => ({
        arqueoId: d.arqueo.id,
        sede: d.arqueo.tienda.nombre,
        semana: d.arqueo.semana,
        recogido: d.recogido,
        diferencia: d.diferencia,
        descuadre: d.descuadre,
      })),
    });
  }),
);
