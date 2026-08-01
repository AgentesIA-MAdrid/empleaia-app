/**
 * GET /api/cierre-turno/hoy — el cierre de hoy del propio comercial, con lo que
 * ya tenga guardado. Sirve para que el asistente recupere el borrador si cierra
 * a media faena, en vez de empezar de cero.
 *
 * Devuelve también EN QUÉ TIENDA está trabajando hoy (ticket 8c05f3e1): la que
 * ya tenga fijada el cierre o, si aún no hay, la que se le va a proponer para
 * que confirme —mirando dónde fichó, su cuadrante y su ficha, por ese orden—
 * junto a la lista de sedes activas para el desplegable.
 *
 * Por qué: el cierre usaba la sede de la ficha, y un correturnos sin sede veía
 * "No tienes sede asignada" en los objetivos de tienda y en la caja estando de
 * hecho trabajando en una.
 *
 * Y dice si hoy le toca a esta persona **preparar el arqueo semanal**
 * (ticket 3b7e05d1): último turno del domingo en su sede, sin que nadie lo haya
 * declarado ya. Es un paso obligatorio más del cierre.
 *
 * `pendienteEnSede` es distinto de `toca`: es domingo, la tienda no ha declarado
 * su arqueo y a esta persona no le sale el paso porque el cuadrante dice que sale
 * otro después. Si el cuadrante está mal —y a veces lo está—, el domingo se
 * quedaría sin arquear sin que nadie se entere. Se le avisa para que lo diga.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid, pasosPendientes } from "@/lib/cierre-turno/core";
import { sugerirSedeDelDia } from "@/lib/cierre-turno/sede-del-dia";
import { esDiaDeArqueo, tocaArqueo } from "@/lib/cierre-turno/arqueo-obligatorio";
import { semanaISO } from "@/lib/cierre-turno/arqueos";

export const GET = withTenant(
  withFeature("cierre_turno", async () => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaId = ((session.user as any).tiendaId as string | null) ?? null;
    const dia = diaMadrid();
    const fecha = new Date(`${dia}T00:00:00Z`);

    // Pistas para proponerle su tienda de hoy: dónde fichó, qué dice el
    // cuadrante y qué dice su ficha.
    const [sedesActivas, entradaHoy, turnoHoy, cierre] = await Promise.all([
      prisma.tienda.findMany({
        where: { activa: true },
        select: {
          id: true,
          nombre: true,
          latitud: true,
          longitud: true,
          sinEfectivo: true,
          esOficina: true,
          arqueoDiaSemana: true,
        },
        orderBy: { nombre: "asc" },
      }),
      prisma.fichaje.findFirst({
        where: {
          userId,
          tipo: "ENTRADA",
          timestamp: { gte: fecha, lt: new Date(fecha.getTime() + 86_400_000) },
        },
        select: { latitud: true, longitud: true },
        orderBy: { timestamp: "asc" },
      }),
      prisma.turno.findFirst({
        where: { userId, fecha, estado: "PUBLICADO" },
        select: { tiendaId: true },
      }),
      prisma.cierreTurno.findUnique({
        where: { userId_fecha: { userId, fecha } },
        select: {
          id: true,
          tiendaId: true,
          detalleJornada: true,
          incidencia: true,
          completadoEn: true,
          ventas: { select: { articuloId: true, cantidad: true } },
          caja: { select: { id: true, efectivo: true, tarjeta: true, confirmadoEn: true } },
        },
      }),
    ]);

    const sugerida = sugerirSedeDelDia({
      fichaje: entradaHoy,
      turnoTiendaId: turnoHoy?.tiendaId ?? null,
      fichaTiendaId: tiendaId,
      sedes: sedesActivas,
    });

    // La sede del día es la que confirmó al empezar; mientras no confirme, la
    // de su ficha (que es lo que se usaba antes de existir el selector).
    const sedeEfectivaId = cierre?.tiendaId ?? tiendaId;
    const sedeCompleta = sedesActivas.find((t) => t.id === sedeEfectivaId) ?? null;
    const sede = sedeCompleta;
    // Si su sede es de las que venden sin que el dinero sea nuestro (un córner
    // que liquida el tercero), el paso de caja no pide importes: pide el stock y
    // los tickets de las ventas facturadas (ticket 9d4e17c2).
    const sedeSinEfectivo = sede?.sinEfectivo === true;
    const sedes = sedesActivas.map((t) => ({ id: t.id, nombre: t.nombre }));

    // ¿Le toca hoy preparar el arqueo de la semana? Solo se mira si ya sabemos
    // en qué tienda está: sin sede no hay caja que arquear.
    const semana = semanaISO(fecha);
    let arqueo: {
      toca: boolean;
      /** Domingo y la tienda sigue sin declarar, aunque a él no le salga el paso. */
      pendienteEnSede: boolean;
      semana: string;
      sede: string | null;
    } = {
      toca: false,
      pendienteEnSede: false,
      semana,
      sede: sede?.nombre ?? null,
    };
    if (sedeEfectivaId && sedeCompleta) {
      const [turnosDeLaSede, arqueoSemana] = await Promise.all([
        prisma.turno.findMany({
          where: { tiendaId: sedeEfectivaId, fecha, estado: "PUBLICADO" },
          select: { userId: true, horaFin: true },
        }),
        prisma.arqueo.findUnique({
          where: { tiendaId_semana: { tiendaId: sedeEfectivaId, semana } },
          select: { id: true },
        }),
      ]);
      const sedeSinCaja = sedeCompleta.sinEfectivo || sedeCompleta.esOficina;
      const toca = tocaArqueo({
        fecha,
        userId,
        turnosDeLaSede,
        arqueoYaDeclarado: Boolean(arqueoSemana),
        sedeSinCaja,
        arqueoDiaSemana: sedeCompleta.arqueoDiaSemana,
      });
      arqueo = {
        toca,
        pendienteEnSede:
          !toca &&
          !sedeSinCaja &&
          !arqueoSemana &&
          esDiaDeArqueo(fecha, sedeCompleta.arqueoDiaSemana),
        semana,
        sede: sedeCompleta.nombre,
      };
    }

    if (!cierre) {
      return NextResponse.json({
        dia,
        existe: false,
        sedeSinEfectivo,
        sedeNombre: sede?.nombre ?? null,
        // Aún no ha confirmado dónde trabaja hoy: la pantalla se lo pregunta.
        sedeCierre: null,
        sugerida,
        sedes,
        arqueo,
        pendientes: ["ventas", "caja", "incidencias"],
      });
    }

    return NextResponse.json({
      dia,
      existe: true,
      sedeSinEfectivo,
      sedeNombre: sede?.nombre ?? null,
      sedeCierre: cierre.tiendaId,
      sugerida,
      sedes,
      arqueo,
      cerrado: Boolean(cierre.completadoEn),
      detalleJornada: cierre.detalleJornada ?? "",
      incidencia: cierre.incidencia,
      ventas: cierre.ventas
        .filter((v) => v.articuloId)
        .map((v) => ({ articuloId: v.articuloId as string, cantidad: v.cantidad })),
      caja: cierre.caja
        ? {
            efectivo: Number(cierre.caja.efectivo),
            tarjeta: Number(cierre.caja.tarjeta),
            confirmado: Boolean(cierre.caja.confirmadoEn),
          }
        : null,
      pendientes: pasosPendientes({
        ventas: cierre.ventas.length,
        detalleJornada: cierre.detalleJornada,
        cajaConfirmada: Boolean(cierre.caja?.confirmadoEn),
        completadoEn: cierre.completadoEn,
      }),
    });
  }),
);
