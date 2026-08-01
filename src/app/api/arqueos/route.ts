/**
 * Arqueos semanales de efectivo (módulo "Cierre de turno", Enterprise).
 *
 * GET  /api/arqueos?semana=YYYY-Www&tiendaId=…
 *   Devuelve el arqueo de esa semana por sede, con lo que declaró la tienda y
 *   lo que DEBERÍA haber en el cajón. La diferencia se calcula siempre en vivo
 *   para el arqueo pendiente y queda congelada al recogerse (`efectivoCierres`
 *   guardado): si luego se corrige un cierre, lo que se firmó aquel día no
 *   cambia.
 *
 *   Lo esperado NO es solo lo cobrado esta semana: es el efectivo ACUMULADO
 *   pendiente de arquear (ticket 5f0a92c7) — lo que ya había en el cajón más lo
 *   cobrado desde entonces. Una tienda que ya venía funcionando tiene dinero
 *   dentro antes de estrenar el sistema, y compararla contra cero descuadraba
 *   las 16 a la vez. El fondo de cambio (fijo, igual en todas) no entra en esta
 *   cuenta. Ver `lib/cierre-turno/saldo-caja.ts`.
 *
 *   Al declarar el arqueo, el acumulado pasa al sobre y la caja queda a CERO:
 *   se registra ese cero como arranque de la semana siguiente, de modo que la
 *   caja se encadena sola y nadie vuelve a cargar saldos a mano.
 *
 * POST /api/arqueos — declarar (o corregir) el efectivo apartado de una semana.
 *   Uno por sede y semana: es el sobre de la tienda, no el de cada persona. Un
 *   arqueo ya recogido no se toca.
 *
 * Alcance: el empleado ve y declara el de su sede (el efectivo es de la
 * tienda), el coordinador el de la suya, y administración todas.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { esDescuadre, filtroSede } from "@/lib/cierre-turno/core";
import { sedesDelUsuario } from "@/lib/tiendas/sedes-usuario";
import {
  normalizarEfectivoArqueo,
  normalizarSemana,
  rangoSemanaISO,
  semanaDeclarable,
  semanaISO,
  semanaLegible,
} from "@/lib/cierre-turno/arqueos";
import {
  acumuladoDeSede,
  arranquePorSede,
  cobradoDesdeArranque,
  totalesCajaPorSede,
  umbralDescuadre,
} from "@/lib/cierre-turno/caja-queries";
import { acumuladoEnCaja, diferenciaSaldo } from "@/lib/cierre-turno/saldo-caja";

interface Sesion {
  userId: string;
  rol: string;
  tiendaId: string | null;
}

async function sesion(): Promise<Sesion | null> {
  const s = await auth();
  if (!s?.user) return null;
  return {
    userId: s.user.id!,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rol: (s.user as any).rol as string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tiendaId: ((s.user as any).tiendaId as string | null) ?? null,
  };
}

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const s = await sesion();
    if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const url = new URL(req.url);
    const semanaOk = normalizarSemana(url.searchParams.get("semana") ?? semanaISO(new Date()));
    if (!semanaOk.ok) return NextResponse.json({ error: semanaOk.error }, { status: 400 });
    const semana = semanaOk.semana;
    const { desde, hasta } = rangoSemanaISO(semana);

    // Solo administración elige sede; el resto va atado a la suya. Y quien
    // tiene alcance de sede pero ninguna asignada NO ve todas: no ve ninguna.
    const sedesPropias =
      s.rol === "OWNER" ? [] : await sedesDelUsuario(prisma, { userId: s.userId, tiendaId: s.tiendaId });
    const filtro = filtroSede(s.rol, sedesPropias, url.searchParams.get("tiendaId"));
    if (filtro.tipo === "ninguna") {
      return NextResponse.json({
        semana,
        semanaTexto: semanaLegible(semana),
        desde: desde.toISOString().slice(0, 10),
        hasta: hasta.toISOString().slice(0, 10),
        umbral: await umbralDescuadre(prisma),
        yo: { rol: s.rol, puedeRecoger: false, tienePin: false },
        autorizados: [],
        filas: [],
        sinSede: true,
      });
    }
    const tiendaFiltro = filtro.tipo === "sedes" ? filtro.tiendaIds : null;

    const [arqueos, sedes, porSede, umbral, quien] = await Promise.all([
      prisma.arqueo.findMany({
        where: { semana, ...(tiendaFiltro ? { tiendaId: { in: tiendaFiltro } } : {}) },
        select: {
          id: true,
          tiendaId: true,
          semana: true,
          efectivoDeclarado: true,
          efectivoCierres: true,
          efectivoRecogido: true,
          saldoEsperado: true,
          notas: true,
          estado: true,
          declaradoEn: true,
          recogidoEn: true,
          declaradoPor: { select: { nombre: true, apellidos: true } },
          recogidoPor: { select: { nombre: true, apellidos: true } },
        },
      }),
      prisma.tienda.findMany({
        where: {
          activa: true,
          // Fuera las sedes sin efectivo nuestro y la oficina (ticket 9d4e17c2):
          // en un córner el dinero lo liquida el tercero y en la oficina no hay
          // caja. Enseñarlas aquí sería pedir un arqueo que nadie puede hacer.
          esOficina: false,
          sinEfectivo: false,
          ...(tiendaFiltro ? { id: { in: tiendaFiltro } } : {}),
        },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" },
      }),
      totalesCajaPorSede(prisma, { desde, hasta, tiendaIds: tiendaFiltro }),
      umbralDescuadre(prisma),
      // Quién puede firmar la recogida: se enseña para que en la tienda sepan a
      // quién esperar, sin exponer nada del PIN.
      prisma.user.findMany({
        where: { activo: true, puedeRecogerEfectivo: true },
        select: { id: true, nombre: true, apellidos: true, pinRecogidaHash: true },
        orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
      }),
    ]);

    // De dónde arranca la caja de cada sede y lo cobrado desde entonces. Dos
    // consultas más, no una por tienda.
    const arranques = await arranquePorSede(prisma, { antesDe: hasta, tiendaIds: tiendaFiltro });
    const cobradoPorSede = await cobradoDesdeArranque(prisma, {
      arranques,
      hasta,
      tiendaIds: tiendaFiltro,
    });

    const porTienda = new Map(arqueos.map((a) => [a.tiendaId, a]));

    const filas = sedes.map((sede) => {
      const a = porTienda.get(sede.id) ?? null;
      const cierres = porSede.get(sede.id)?.efectivo ?? 0;
      const declarado = a ? Number(a.efectivoDeclarado) : null;
      // Congelado al recoger; en vivo mientras siga pendiente.
      const segunCierres = a && a.estado === "recogido" ? Number(a.efectivoCierres) : cierres;

      const arranque = arranques.get(sede.id) ?? null;
      const saldo = acumuladoEnCaja({ arranque, cobrado: cobradoPorSede.get(sede.id) ?? 0 });
      // Congelado al declarar: a partir de ahí el dinero ya está en el sobre y
      // la caja vuelve a cero, así que recalcularlo daría otro número. Lo que se
      // declaró aquel día es lo que tiene que seguir viéndose.
      const esperado = a && a.saldoEsperado !== null ? Number(a.saldoEsperado) : saldo.esperado;
      const diferencia = declarado === null ? null : diferenciaSaldo(declarado, esperado);

      return {
        arqueoId: a?.id ?? null,
        tiendaId: sede.id,
        sede: sede.nombre,
        declarado,
        segunCierres,
        // El desglose de la cuenta, para poder enseñarla entera en la tarjeta.
        arranque: arranque
          ? {
              fecha: arranque.fecha.toISOString().slice(0, 10),
              importe: arranque.importe,
              incidencia: arranque.incidencia,
            }
          : null,
        cobradoDesdeArranque: saldo.cobrado,
        esperado,
        sinSaldoMotivo: esperado === null ? saldo.motivo : null,
        diferencia,
        descuadre: diferencia === null ? false : esDescuadre(diferencia, umbral),
        estado: (a?.estado ?? "sin_declarar") as "sin_declarar" | "pendiente" | "recogido",
        notas: a?.notas ?? null,
        declaradoPor: a?.declaradoPor
          ? `${a.declaradoPor.nombre} ${a.declaradoPor.apellidos}`.trim()
          : null,
        declaradoEn: a?.declaradoEn?.toISOString() ?? null,
        recogidoPor: a?.recogidoPor ? `${a.recogidoPor.nombre} ${a.recogidoPor.apellidos}`.trim() : null,
        recogidoEn: a?.recogidoEn?.toISOString() ?? null,
        efectivoRecogido: a?.efectivoRecogido === null || a?.efectivoRecogido === undefined ? null : Number(a.efectivoRecogido),
      };
    });

    return NextResponse.json({
      semana,
      semanaTexto: semanaLegible(semana),
      desde: desde.toISOString().slice(0, 10),
      hasta: hasta.toISOString().slice(0, 10),
      umbral,
      // Quién es la persona que ve esto, para que la pantalla sepa si ofrecer
      // el botón de firmar la recogida.
      yo: {
        rol: s.rol,
        // El PIN no viaja nunca; solo si lo tiene configurado.
        puedeRecoger: quien.some((q) => q.id === s.userId),
        tienePin: quien.some((q) => q.id === s.userId && Boolean(q.pinRecogidaHash)),
      },
      autorizados: quien.map((q) => ({
        id: q.id,
        nombre: `${q.nombre} ${q.apellidos}`.trim(),
        conPin: Boolean(q.pinRecogidaHash),
      })),
      filas,
    });
  }),
);

export const POST = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const s = await sesion();
    if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as {
      semana?: unknown;
      tiendaId?: unknown;
      efectivo?: unknown;
      notas?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

    const semanaOk = normalizarSemana(body.semana);
    if (!semanaOk.ok) return NextResponse.json({ error: semanaOk.error }, { status: 400 });
    if (!semanaDeclarable(semanaOk.semana)) {
      return NextResponse.json(
        { error: "Esa semana todavía no ha empezado." },
        { status: 400 },
      );
    }
    const efectivoOk = normalizarEfectivoArqueo(body.efectivo);
    if (!efectivoOk.ok) return NextResponse.json({ error: efectivoOk.error }, { status: 400 });

    // Administración declara la sede que quiera. Quien coordina varias declara
    // la que diga, siempre que sea una de las suyas (ticket 73); el resto, la
    // principal de su ficha.
    const sedePedida = typeof body.tiendaId === "string" && body.tiendaId ? body.tiendaId : null;
    let tiendaId: string | null;
    if (s.rol === "OWNER") {
      tiendaId = sedePedida ?? s.tiendaId;
    } else {
      const propias = await sedesDelUsuario(prisma, { userId: s.userId, tiendaId: s.tiendaId });
      tiendaId = sedePedida && propias.includes(sedePedida) ? sedePedida : (s.tiendaId ?? propias[0] ?? null);
    }
    if (!tiendaId) {
      return NextResponse.json(
        { error: "No tienes sede asignada, así que no puedes declarar su efectivo. Habla con administración." },
        { status: 409 },
      );
    }

    const notas =
      typeof body.notas === "string" && body.notas.trim() ? body.notas.trim().slice(0, 1000) : null;

    const { desde, hasta } = rangoSemanaISO(semanaOk.semana);
    const previo = await prisma.arqueo.findUnique({
      where: { tiendaId_semana: { tiendaId, semana: semanaOk.semana } },
      select: { id: true, estado: true },
    });
    if (previo?.estado === "recogido") {
      return NextResponse.json(
        {
          error: "Ese arqueo ya se ha recogido y firmado, así que no se puede cambiar. Habla con administración.",
          code: "arqueo_recogido",
        },
        { status: 409 },
      );
    }

    // `efectivoCierres` se guarda ya aquí (y se refresca al recoger): así el
    // arqueo lleva encima con qué se comparó, no solo el resultado.
    const porSede = await totalesCajaPorSede(prisma, { desde, hasta, tiendaId });
    const segunCierres = porSede.get(tiendaId)?.efectivo ?? 0;
    const saldo = await acumuladoDeSede(prisma, { tiendaId, hasta });

    const arqueo = await prisma.$transaction(async (tx) => {
      const a = await tx.arqueo.upsert({
        where: { tiendaId_semana: { tiendaId, semana: semanaOk.semana } },
        create: {
          tiendaId,
          semana: semanaOk.semana,
          desde,
          hasta,
          efectivoDeclarado: efectivoOk.importe,
          efectivoCierres: segunCierres,
          saldoEsperado: saldo.esperado,
          notas,
          declaradoPorId: s.userId,
          declaradoEn: new Date(),
        },
        update: {
          efectivoDeclarado: efectivoOk.importe,
          efectivoCierres: segunCierres,
          saldoEsperado: saldo.esperado,
          notas,
          declaradoPorId: s.userId,
          declaradoEn: new Date(),
        },
        select: { id: true, efectivoDeclarado: true, efectivoCierres: true, estado: true },
      });

      // El acumulado se ha metido en el sobre: la caja vuelve a CERO y ese cero
      // es el arranque de la semana siguiente (ticket 5f0a92c7). Va con la fecha
      // del último día arqueado, así que los cobros que cuentan a partir de
      // ahora son los del día siguiente. Se re-escribe si corrigen la
      // declaración: sigue siendo cero, y la nota deja dicho de dónde sale.
      await tx.fondoCaja.upsert({
        where: { tiendaId_fecha: { tiendaId, fecha: hasta } },
        create: {
          tiendaId,
          fecha: hasta,
          importe: 0,
          incidencia: null,
          nota: `Arqueo de la semana ${semanaOk.semana}: el acumulado pasa al sobre.`,
          registradoPorId: s.userId,
        },
        update: {
          importe: 0,
          incidencia: null,
          nota: `Arqueo de la semana ${semanaOk.semana}: el acumulado pasa al sobre.`,
          registradoPorId: s.userId,
        },
      });
      return a;
    });

    const declarado = Number(arqueo.efectivoDeclarado);
    // Contra el saldo de la caja, no contra los cierres a secas (ticket 5f0a92c7).
    const diferencia = diferenciaSaldo(declarado, saldo.esperado);
    const umbral = await umbralDescuadre(prisma);

    return NextResponse.json({
      id: arqueo.id,
      semana: semanaOk.semana,
      declarado,
      segunCierres,
      esperado: saldo.esperado,
      sinSaldoMotivo: saldo.motivo,
      diferencia,
      descuadre: diferencia === null ? false : esDescuadre(diferencia, umbral),
      estado: arqueo.estado,
    });
  }),
);
