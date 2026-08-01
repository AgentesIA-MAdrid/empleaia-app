/**
 * Arqueos semanales de efectivo (módulo "Cierre de turno", Enterprise).
 *
 * GET  /api/arqueos?semana=YYYY-Www&tiendaId=…
 *   Devuelve el arqueo de esa semana por sede, con lo que declaró la tienda y
 *   lo que suman los cierres de caja confirmados de esos días. La diferencia se
 *   calcula siempre en vivo para el arqueo pendiente y queda congelada al
 *   recogerse (`efectivoCierres` guardado): si luego se corrige un cierre, lo
 *   que se firmó aquel día no cambia.
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
import { diferenciaArqueo, esDescuadre, filtroSede } from "@/lib/cierre-turno/core";
import { sedesDelUsuario } from "@/lib/tiendas/sedes-usuario";
import {
  normalizarEfectivoArqueo,
  normalizarSemana,
  rangoSemanaISO,
  semanaDeclarable,
  semanaISO,
  semanaLegible,
} from "@/lib/cierre-turno/arqueos";
import { totalesCajaPorSede, umbralDescuadre } from "@/lib/cierre-turno/caja-queries";

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

    const porTienda = new Map(arqueos.map((a) => [a.tiendaId, a]));

    const filas = sedes.map((sede) => {
      const a = porTienda.get(sede.id) ?? null;
      const cierres = porSede.get(sede.id)?.efectivo ?? 0;
      const declarado = a ? Number(a.efectivoDeclarado) : null;
      // Congelado al recoger; en vivo mientras siga pendiente.
      const segunCierres = a && a.estado === "recogido" ? Number(a.efectivoCierres) : cierres;
      const diferencia = declarado === null ? null : diferenciaArqueo(declarado, segunCierres);
      return {
        arqueoId: a?.id ?? null,
        tiendaId: sede.id,
        sede: sede.nombre,
        declarado,
        segunCierres,
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

    const arqueo = await prisma.arqueo.upsert({
      where: { tiendaId_semana: { tiendaId, semana: semanaOk.semana } },
      create: {
        tiendaId,
        semana: semanaOk.semana,
        desde,
        hasta,
        efectivoDeclarado: efectivoOk.importe,
        efectivoCierres: segunCierres,
        notas,
        declaradoPorId: s.userId,
        declaradoEn: new Date(),
      },
      update: {
        efectivoDeclarado: efectivoOk.importe,
        efectivoCierres: segunCierres,
        notas,
        declaradoPorId: s.userId,
        declaradoEn: new Date(),
      },
      select: { id: true, efectivoDeclarado: true, efectivoCierres: true, estado: true },
    });

    const declarado = Number(arqueo.efectivoDeclarado);
    const diferencia = diferenciaArqueo(declarado, segunCierres);
    const umbral = await umbralDescuadre(prisma);

    return NextResponse.json({
      id: arqueo.id,
      semana: semanaOk.semana,
      declarado,
      segunCierres,
      diferencia,
      descuadre: esDescuadre(diferencia, umbral),
      estado: arqueo.estado,
    });
  }),
);
