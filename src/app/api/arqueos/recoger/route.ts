/**
 * POST /api/arqueos/recoger — firma la recogida del efectivo de un arqueo.
 *
 * Quien recoge se identifica con su PIN, no solo con su sesión: el móvil suele
 * estar abierto encima del mostrador y la firma tiene que valer para decir "este
 * dinero se lo llevó esta persona". El PIN se guarda en bcrypt, nunca en claro.
 *
 * Tras varios fallos seguidos se bloquea la firma un rato (no la cuenta): quien
 * recoge está físicamente en la tienda y no puede quedarse fuera por teclear mal
 * dos veces. La política vive en `arqueos.ts` y está testeada aparte.
 *
 * Al recoger se congela `efectivoCierres`: si mañana se corrige un cierre de esa
 * semana, lo que se firmó aquel día no cambia.
 *
 * Aquí NO se toca el saldo de la caja: el dinero salió del cajón cuando se
 * declaró el arqueo el domingo y se metió en el sobre (ahí es donde la caja
 * quedó a cero, ver POST /api/arqueos). Esto es la firma de que un responsable
 * se llevó ese sobre.
 */

import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { esDescuadre } from "@/lib/cierre-turno/core";
import { diferenciaSaldo } from "@/lib/cierre-turno/saldo-caja";
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

    const body = (await req.json().catch(() => null)) as {
      arqueoId?: unknown;
      pin?: unknown;
      /** Si se lleva menos de lo declarado (deja fondo de caja, p. ej.). */
      efectivoRecogido?: unknown;
    } | null;
    if (!body || typeof body.arqueoId !== "string") {
      return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
    }

    const yo = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nombre: true,
        apellidos: true,
        puedeRecogerEfectivo: true,
        pinRecogidaHash: true,
        pinRecogidaIntentos: true,
        pinRecogidaBloqueoHasta: true,
      },
    });
    if (!yo?.puedeRecogerEfectivo) {
      return NextResponse.json(
        { error: "No estás autorizado a recoger efectivo. Lo habilita administración." },
        { status: 403 },
      );
    }
    if (!yo.pinRecogidaHash) {
      return NextResponse.json(
        {
          error: "No tienes PIN de recogida. Pide a administración que te lo asigne.",
          code: "sin_pin",
        },
        { status: 409 },
      );
    }

    const estadoPin = { intentos: yo.pinRecogidaIntentos, bloqueoHasta: yo.pinRecogidaBloqueoHasta };
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
    if (!pin) return NextResponse.json({ error: "Escribe tu PIN." }, { status: 400 });

    if (!(await bcrypt.compare(pin, yo.pinRecogidaHash))) {
      const nuevo = trasFalloPin(estadoPin);
      await prisma.user.update({
        where: { id: userId },
        data: {
          pinRecogidaIntentos: nuevo.intentos,
          pinRecogidaBloqueoHasta: nuevo.bloqueoHasta,
        },
      });
      const bloqueado = pinBloqueado(nuevo);
      return NextResponse.json(
        {
          error: bloqueado
            ? `PIN incorrecto. Has agotado los intentos: prueba de nuevo en ${minutosDeBloqueo(nuevo)} minutos.`
            : "PIN incorrecto.",
          code: bloqueado ? "pin_bloqueado" : "pin_incorrecto",
        },
        { status: bloqueado ? 429 : 401 },
      );
    }

    const arqueo = await prisma.arqueo.findUnique({
      where: { id: body.arqueoId },
      select: {
        id: true,
        semana: true,
        tiendaId: true,
        estado: true,
        efectivoDeclarado: true,
        saldoEsperado: true,
        tienda: { select: { id: true, nombre: true } },
      },
    });
    if (!arqueo) return NextResponse.json({ error: "Arqueo no encontrado" }, { status: 404 });
    if (arqueo.estado === "recogido") {
      return NextResponse.json(
        { error: "Ese arqueo ya estaba recogido.", code: "ya_recogido" },
        { status: 409 },
      );
    }

    const declarado = Number(arqueo.efectivoDeclarado);
    let recogido = declarado;
    if (body.efectivoRecogido !== undefined && body.efectivoRecogido !== null && body.efectivoRecogido !== "") {
      const v = normalizarEfectivoArqueo(body.efectivoRecogido);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      if (v.importe > declarado) {
        return NextResponse.json(
          { error: "No puedes recoger más de lo que la tienda declaró." },
          { status: 400 },
        );
      }
      recogido = v.importe;
    }

    // Se congela con qué se comparó, en el momento de la firma.
    const { desde, hasta } = rangoSemanaISO(arqueo.semana);
    const porSede = await totalesCajaPorSede(prisma, { desde, hasta, tiendaId: arqueo.tiendaId });
    const segunCierres = porSede.get(arqueo.tiendaId)?.efectivo ?? 0;
    const umbral = await umbralDescuadre(prisma);
    // Contra el acumulado con el que se declaró, que es el número que la tienda
    // tenía delante al contar el dinero (ticket 5f0a92c7). Si el arqueo es
    // anterior a esta cuenta no hay saldo guardado: entonces no hay diferencia
    // que dar, en vez de inventar una.
    const esperado = arqueo.saldoEsperado === null ? null : Number(arqueo.saldoEsperado);
    const diferencia = diferenciaSaldo(declarado, esperado);

    const limpio = trasAciertoPin();
    await prisma.$transaction(async (tx) => {
      await tx.arqueo.update({
        where: { id: arqueo.id },
        data: {
          estado: "recogido",
          recogidoPorId: userId,
          recogidoEn: new Date(),
          efectivoRecogido: recogido,
          efectivoCierres: segunCierres,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { pinRecogidaIntentos: limpio.intentos, pinRecogidaBloqueoHasta: limpio.bloqueoHasta },
      });
    });

    // El correo va después de guardar y sin bloquear la respuesta: perder un
    // aviso es molesto, perder la firma de una recogida es inaceptable.
    await notifyRecogidaEfectivo({
      recogidoPor: { id: yo.id, nombre: yo.nombre, apellidos: yo.apellidos },
      sede: arqueo.tienda,
      semana: arqueo.semana,
      declarado,
      recogido,
      segunCierres,
      diferencia: diferencia ?? 0,
      descuadre: diferencia === null ? false : esDescuadre(diferencia, umbral),
    });

    return NextResponse.json({
      ok: true,
      arqueoId: arqueo.id,
      recogido,
      segunCierres,
      esperado,
      diferencia,
      descuadre: diferencia === null ? false : esDescuadre(diferencia, umbral),
    });
  }),
);
