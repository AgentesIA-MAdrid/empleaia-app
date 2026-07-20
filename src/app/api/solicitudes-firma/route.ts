/**
 * /api/solicitudes-firma
 *
 *   GET  → lista solicitudes (admin todas, empleado solo las suyas)
 *   POST → crear solicitud (admin asigna a un empleado un doc para firmar)
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { crearSolicitudFirma } from "@/lib/firmas/solicitudes";

const createSchema = z.object({
  documentoId: z.string(),
  destinatarioId: z.string(),
  mensaje: z.string().max(1000).optional(),
  expiraEn: z.string().datetime().optional(),
});

export const POST = withTenant(async (req: NextRequest) => {
  const session = await auth();
  const user = session?.user as { id?: string; rol?: Rol | string } | undefined;
  // Asignar documentos para firma es gestión: solo el Administrador (OWNER).
  if (!user?.id || user.rol !== Rol.OWNER) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const documento = await prismaApp.documento.findUnique({
    where: { id: data.documentoId },
    select: { id: true },
  });
  if (!documento) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  }

  const solicitud = await crearSolicitudFirma({
    documentoId: data.documentoId,
    destinatarioId: data.destinatarioId,
    solicitadaPorId: user.id,
    mensaje: data.mensaje,
    expiraEn: data.expiraEn ? new Date(data.expiraEn) : null,
  });

  return NextResponse.json({ solicitud }, { status: 201 });
});

export const GET = withTenant(async (req: NextRequest) => {
  const session = await auth();
  const user = session?.user as { id?: string; rol?: Rol | string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const isAdmin = user.rol === Rol.OWNER || user.rol === Rol.MANAGER;
  const ambito = req.nextUrl.searchParams.get("ambito") ?? "todas";

  const where: Record<string, unknown> = {};
  if (!isAdmin || ambito === "mias") {
    where.destinatarioId = user.id;
  } else if (ambito === "enviadas") {
    where.solicitadaPorId = user.id;
  }

  const items = await prismaApp.solicitudFirma.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      documento: { select: { id: true, nombre: true } },
      destinatario: { select: { id: true, nombre: true, apellidos: true, email: true } },
      solicitadaPor: { select: { id: true, nombre: true, apellidos: true } },
      firma: { select: { id: true, firmadoEn: true } },
    },
  });
  return NextResponse.json({ items, total: items.length });
});
