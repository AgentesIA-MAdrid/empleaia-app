/**
 * Grupos de objetivos (ticket ff5ab304) — el tercer ámbito de los objetivos de
 * venta, junto al comercial ("individual") y al punto de venta ("tienda").
 *
 * Un grupo es una agrupación con nombre del cliente ("TMT", "Televenta"…)
 * formada por comerciales y/o sedes. Los grupos no se cablean en el código: se
 * dan de alta aquí, así que el cliente puede montar los que necesite.
 *
 * GET  /api/objetivos-venta/grupos — los grupos con sus miembros, más la lista
 *   de comerciales y de sedes para poder elegirlos en pantalla.
 * POST /api/objetivos-venta/grupos — crea un grupo con sus miembros.
 *
 * Solo administración: quien fija objetivos es quien decide las agrupaciones
 * sobre las que se fijan. Coordinación ve la parrilla de grupos que le sirve
 * `/api/objetivos-venta`, pero no los toca ni ve la plantilla completa.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { puedeFijarObjetivos } from "@/lib/cierre-turno/core";
import { claveGrupo, normalizarNombreGrupo } from "@/lib/cierre-turno/objetivos";
import { CAMPOS_GRUPO, miembrosValidos, serializarGrupo } from "@/lib/cierre-turno/grupos-queries";

/** Solo administración toca los grupos; el resto ni los lista. */
async function soloAdministracion(): Promise<Response | null> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rol = (session.user as any).rol as string;
  if (!puedeFijarObjetivos(rol)) {
    return NextResponse.json(
      { error: "Solo un administrador puede gestionar los grupos de objetivos." },
      { status: 403 },
    );
  }
  return null;
}

export const GET = withTenant(
  withFeature("cierre_turno", async () => {
    const veto = await soloAdministracion();
    if (veto) return veto;

    const [grupos, personas, sedes] = await Promise.all([
      prisma.grupoObjetivo.findMany({
        select: CAMPOS_GRUPO,
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      }),
      prisma.user.findMany({
        where: { activo: true },
        select: { id: true, nombre: true, apellidos: true, tienda: { select: { nombre: true } } },
        orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
      }),
      prisma.tienda.findMany({
        where: { activa: true },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" },
      }),
    ]);

    return NextResponse.json({
      grupos: grupos.map(serializarGrupo),
      comerciales: personas.map((p) => ({
        id: p.id,
        nombre: `${p.nombre} ${p.apellidos}`.trim(),
        sede: p.tienda?.nombre ?? null,
      })),
      sedes,
    });
  }),
);

export const POST = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const veto = await soloAdministracion();
    if (veto) return veto;

    const body = (await req.json().catch(() => null)) as {
      nombre?: unknown;
      userIds?: unknown;
      tiendaIds?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

    const nombreOk = normalizarNombreGrupo(body.nombre);
    if (!nombreOk.ok) return NextResponse.json({ error: nombreOk.error }, { status: 400 });
    const miembros = await miembrosValidos(prisma, body.userIds, body.tiendaIds);

    // Todo en una transacción: entre mirar si el nombre está cogido y crear el
    // grupo no puede colarse otra pestaña con el mismo "TMT".
    const resultado = await prisma.$transaction(async (tx) => {
      const previos = await tx.grupoObjetivo.findMany({
        select: { id: true, nombre: true, orden: true },
      });
      const clave = claveGrupo(nombreOk.nombre);
      if (previos.some((p) => claveGrupo(p.nombre) === clave)) {
        return { estado: "duplicado" as const };
      }
      const orden = previos.reduce((max, p) => Math.max(max, p.orden), -1) + 1;
      const creado = await tx.grupoObjetivo.create({
        data: {
          nombre: nombreOk.nombre,
          orden,
          miembros: {
            create: [
              ...miembros.userIds.map((userId) => ({ userId })),
              ...miembros.tiendaIds.map((tiendaId) => ({ tiendaId })),
            ],
          },
        },
        select: CAMPOS_GRUPO,
      });
      return { estado: "creado" as const, grupo: creado };
    });

    if (resultado.estado === "duplicado") {
      return NextResponse.json({ error: "Ya tienes un grupo con ese nombre." }, { status: 409 });
    }
    return NextResponse.json({
      grupo: serializarGrupo(resultado.grupo),
      descartados: miembros.descartados,
    });
  }),
);
