/**
 * PATCH  /api/objetivos-venta/grupos/[id] — renombra un grupo de objetivos,
 *   cambia sus miembros o lo activa/desactiva.
 * DELETE /api/objetivos-venta/grupos/[id] — lo borra, si no tiene objetivos
 *   fijados. Con objetivos se desactiva (PATCH `activo: false`): borrarlo se
 *   llevaría por delante las cifras de meses ya cerrados.
 *
 * Solo administración, igual que dar de alta el grupo (ticket ff5ab304).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { puedeFijarObjetivos } from "@/lib/cierre-turno/core";
import { claveGrupo, normalizarNombreGrupo } from "@/lib/cierre-turno/objetivos";
import { CAMPOS_GRUPO, miembrosValidos, serializarGrupo } from "@/lib/cierre-turno/grupos-queries";

/** Solo administración toca los grupos. */
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

export const PATCH = withTenant(
  withFeature(
    "cierre_turno",
    async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
      const veto = await soloAdministracion();
      if (veto) return veto;

      const { id } = await params;
      const body = (await req.json().catch(() => null)) as {
        nombre?: unknown;
        activo?: unknown;
        userIds?: unknown;
        tiendaIds?: unknown;
      } | null;
      if (!body) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

      const grupo = await prisma.grupoObjetivo.findUnique({ where: { id }, select: { id: true } });
      if (!grupo) return NextResponse.json({ error: "Ese grupo ya no existe." }, { status: 404 });

      let nombre: string | undefined;
      if (body.nombre !== undefined) {
        const nombreOk = normalizarNombreGrupo(body.nombre);
        if (!nombreOk.ok) return NextResponse.json({ error: nombreOk.error }, { status: 400 });
        nombre = nombreOk.nombre;
      }

      // Los miembros solo se tocan si vienen: un PATCH que solo desactiva no
      // puede dejar el grupo vacío por el camino. Si viene una de las dos
      // listas se reemplazan LAS DOS (es lo que manda la pantalla, que siempre
      // envía la composición completa).
      const cambiaMiembros = body.userIds !== undefined || body.tiendaIds !== undefined;
      const miembros = cambiaMiembros
        ? await miembrosValidos(prisma, body.userIds, body.tiendaIds)
        : null;

      const resultado = await prisma.$transaction(async (tx) => {
        if (nombre !== undefined) {
          const previos = await tx.grupoObjetivo.findMany({ select: { id: true, nombre: true } });
          const clave = claveGrupo(nombre);
          if (previos.some((p) => p.id !== id && claveGrupo(p.nombre) === clave)) {
            return { estado: "duplicado" as const };
          }
        }
        if (miembros) {
          // Se reemplaza la lista entera: es lo que manda la pantalla y evita
          // tener que calcular altas y bajas en el cliente.
          await tx.grupoObjetivoMiembro.deleteMany({ where: { grupoId: id } });
          if (miembros.userIds.length + miembros.tiendaIds.length > 0) {
            await tx.grupoObjetivoMiembro.createMany({
              data: [
                ...miembros.userIds.map((userId) => ({ grupoId: id, userId })),
                ...miembros.tiendaIds.map((tiendaId) => ({ grupoId: id, tiendaId })),
              ],
            });
          }
        }
        const actualizado = await tx.grupoObjetivo.update({
          where: { id },
          data: {
            ...(nombre !== undefined ? { nombre } : {}),
            ...(typeof body.activo === "boolean" ? { activo: body.activo } : {}),
          },
          select: CAMPOS_GRUPO,
        });
        return { estado: "ok" as const, grupo: actualizado };
      });

      if (resultado.estado === "duplicado") {
        return NextResponse.json({ error: "Ya tienes un grupo con ese nombre." }, { status: 409 });
      }
      return NextResponse.json({
        grupo: serializarGrupo(resultado.grupo),
        descartados: miembros?.descartados ?? 0,
      });
    },
  ),
);

export const DELETE = withTenant(
  withFeature(
    "cierre_turno",
    async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
      const veto = await soloAdministracion();
      if (veto) return veto;

      const { id } = await params;
      const grupo = await prisma.grupoObjetivo.findUnique({ where: { id }, select: { id: true } });
      if (!grupo) return NextResponse.json({ error: "Ese grupo ya no existe." }, { status: 404 });

      // Con objetivos fijados no se borra: el histórico de un mes cerrado tiene
      // que seguir siendo legible (misma regla que el catálogo de ventas).
      const conObjetivos = await prisma.objetivoVenta.findFirst({
        where: { grupoId: id },
        select: { id: true },
      });
      if (conObjetivos) {
        return NextResponse.json(
          {
            error:
              "Ese grupo ya tiene objetivos fijados. Desactívalo para dejar de usarlo sin perder el histórico.",
          },
          { status: 409 },
        );
      }

      await prisma.grupoObjetivo.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    },
  ),
);
