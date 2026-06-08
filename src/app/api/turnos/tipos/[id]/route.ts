/**
 * PUT/DELETE /api/turnos/tipos/[id]
 *
 * Edita y desactiva tipos de turno. DELETE es soft-delete (activo=false)
 * para preservar la integridad con Turno.tipoTurnoId (FK ON DELETE SET
 * NULL: aunque se borrase físicamente no rompería, pero soft-delete
 * conserva el historial de turnos con su etiqueta).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const PUT = withTenant(
  withFeature("turnos_publicacion", async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const { id } = await params;
    const body = (await request.json()) as Partial<{
      nombre: string;
      abreviatura: string;
      color: string;
      horaInicio: string | null;
      horaFin: string | null;
      horas: number;
      esLibre: boolean;
      orden: number;
      activo: boolean;
    }>;
    const data: Record<string, unknown> = {};
    for (const k of [
      "nombre",
      "abreviatura",
      "color",
      "horaInicio",
      "horaFin",
      "horas",
      "esLibre",
      "orden",
      "activo",
    ] as const) {
      if (k in body) data[k] = body[k];
    }
    try {
      const tipo = await prisma.tipoTurno.update({ where: { id }, data });
      return NextResponse.json(tipo);
    } catch {
      return NextResponse.json({ error: "tipo_turno_no_existe" }, { status: 404 });
    }
  }),
);

export const DELETE = withTenant(
  withFeature("turnos_publicacion", async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (user.rol !== Rol.OWNER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const { id } = await params;
    try {
      await prisma.tipoTurno.update({ where: { id }, data: { activo: false } });
      return NextResponse.json({ success: true });
    } catch {
      return NextResponse.json({ error: "tipo_turno_no_existe" }, { status: 404 });
    }
  }),
);
