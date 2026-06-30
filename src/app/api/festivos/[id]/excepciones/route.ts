import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextRequest, NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";

/**
 * Excepciones de festivo por empleado.
 *
 *   POST   → "quita" el festivo a un empleado (ese día trabaja: horas extra).
 *   DELETE → restaura el festivo para ese empleado.
 *
 * Solo OWNER (toda la plantilla) y MANAGER (empleados de su sede).
 */

/** Comprueba que quien edita puede gestionar al empleado destino. */
async function puedeGestionar(
  sessionUser: { rol?: Rol; tiendaId?: string | null },
  userId: string,
): Promise<boolean> {
  const rol = sessionUser.rol;
  if (rol === Rol.OWNER) return true;
  if (rol === Rol.MANAGER) {
    const managerTiendaId = sessionUser.tiendaId ?? null;
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { tiendaId: true },
    });
    return !!target && target.tiendaId === managerTiendaId;
  }
  return false;
}

export const POST = withTenant(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await auth();
      if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

      const { id: festivoId } = await params;
      const { userId } = (await req.json()) as { userId?: string };
      if (!userId) return NextResponse.json({ error: "userId requerido" }, { status: 400 });

      if (!(await puedeGestionar(session.user as { rol?: Rol; tiendaId?: string | null }, userId))) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }

      const festivo = await prisma.festivo.findUnique({ where: { id: festivoId } });
      if (!festivo) return NextResponse.json({ error: "Festivo no encontrado" }, { status: 404 });

      // Idempotente: si ya existe la excepción, no falla.
      const excepcion = await prisma.festivoExcepcion.upsert({
        where: { festivoId_userId: { festivoId, userId } },
        create: { festivoId, userId },
        update: {},
      });

      return NextResponse.json({ excepcion }, { status: 201 });
    } catch (error) {
      console.error("POST /api/festivos/[id]/excepciones error:", error);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  },
);

export const DELETE = withTenant(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await auth();
      if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

      const { id: festivoId } = await params;
      const userId = new URL(req.url).searchParams.get("userId");
      if (!userId) return NextResponse.json({ error: "userId requerido" }, { status: 400 });

      if (!(await puedeGestionar(session.user as { rol?: Rol; tiendaId?: string | null }, userId))) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }

      await prisma.festivoExcepcion.deleteMany({ where: { festivoId, userId } });
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("DELETE /api/festivos/[id]/excepciones error:", error);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  },
);
