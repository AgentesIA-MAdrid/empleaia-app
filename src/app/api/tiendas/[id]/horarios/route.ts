/**
 * GET/PUT /api/tiendas/[id]/horarios
 *
 * Horarios de apertura de una sede. Modelo flexible: N tramos por día
 * (HorarioSede). Sin tramos para un día = cerrado.
 *
 * - GET: devuelve los tramos de la sede (orden por día y orden).
 * - PUT (OWNER): reemplaza el set COMPLETO de tramos de la sede en una
 *   transacción (deleteMany + createMany).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { withTenant } from "@/lib/tenant/with-tenant";
import type { NextRequest } from "next/server";

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // "HH:MM" 24h

interface TramoInput {
  diaSemana: number;
  horaApertura: string;
  horaCierre: string;
}

export const GET = withTenant(async (_request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) return Response.json({ error: "No autorizado" }, { status: 401 });

    const { id } = await params;
    const tramos = await prisma.horarioSede.findMany({
      where: { tiendaId: id },
      orderBy: [{ diaSemana: "asc" }, { orden: "asc" }],
      select: { id: true, diaSemana: true, horaApertura: true, horaCierre: true, orden: true },
    });
    return Response.json({ tramos });
  } catch (error) {
    console.error("GET /api/tiendas/[id]/horarios error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const PUT = withTenant(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) return Response.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) return Response.json({ error: "No autorizado" }, { status: 403 });

    const { id } = await params;
    const tienda = await prisma.tienda.findUnique({ where: { id }, select: { id: true } });
    if (!tienda) return Response.json({ error: "Sede no encontrada" }, { status: 404 });

    const body = await request.json().catch(() => null) as { tramos?: unknown } | null;
    const tramosRaw = Array.isArray(body?.tramos) ? body!.tramos : null;
    if (!tramosRaw) {
      return Response.json({ error: "Falta el array 'tramos'" }, { status: 400 });
    }

    // Validar y normalizar.
    const tramos: TramoInput[] = [];
    for (const t of tramosRaw as TramoInput[]) {
      const dia = Number(t?.diaSemana);
      if (!Number.isInteger(dia) || dia < 0 || dia > 6) {
        return Response.json({ error: "diaSemana inválido (0–6)" }, { status: 400 });
      }
      if (!HORA_RE.test(t?.horaApertura) || !HORA_RE.test(t?.horaCierre)) {
        return Response.json({ error: "Hora inválida (formato HH:MM)" }, { status: 400 });
      }
      if (t.horaApertura >= t.horaCierre) {
        return Response.json(
          { error: "La hora de apertura debe ser anterior a la de cierre" },
          { status: 400 },
        );
      }
      tramos.push({ diaSemana: dia, horaApertura: t.horaApertura, horaCierre: t.horaCierre });
    }

    // Reemplazo completo en transacción. `orden` por posición dentro del día.
    const ordenPorDia: Record<number, number> = {};
    const data = tramos.map((t) => ({
      tiendaId: id,
      diaSemana: t.diaSemana,
      horaApertura: t.horaApertura,
      horaCierre: t.horaCierre,
      orden: (ordenPorDia[t.diaSemana] = (ordenPorDia[t.diaSemana] ?? -1) + 1),
    }));

    await prisma.$transaction([
      prisma.horarioSede.deleteMany({ where: { tiendaId: id } }),
      ...(data.length > 0 ? [prisma.horarioSede.createMany({ data })] : []),
    ]);

    return Response.json({ success: true, count: data.length });
  } catch (error) {
    console.error("PUT /api/tiendas/[id]/horarios error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
