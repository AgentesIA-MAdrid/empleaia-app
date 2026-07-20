import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";

// El empleado destinatario rellena los campos marcados en un documento que le
// llegó desde una plantilla. Guarda las respuestas alineadas por índice con
// `Documento.campos`. Solo puede hacerlo el propio destinatario.
export const PATCH = withTenant(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { id } = await params;
    const meId = (session.user as { id?: string }).id ?? "";

    const doc = await prisma.documento.findUnique({ where: { id }, select: { userId: true, campos: true } });
    if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
    if (doc.userId !== meId) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const campos = Array.isArray(doc.campos) ? doc.campos : [];
    if (campos.length === 0) {
      return NextResponse.json({ error: "Este documento no tiene campos para rellenar." }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const entrada = Array.isArray(body?.respuestas) ? body.respuestas : [];
    // Una respuesta (string) por campo, alineadas por índice y recortadas.
    const respuestas = campos.map((_, i) =>
      typeof entrada[i] === "string" ? String(entrada[i]).slice(0, 5000) : "",
    );

    await prisma.documento.update({ where: { id }, data: { camposRespuestas: respuestas } });
    return NextResponse.json({ success: true, camposRespuestas: respuestas });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});

export const DELETE = withTenant(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { id } = await params;
    const rol = (session.user as any).rol as string;
    const meId = (session.user as any).id as string;

    const doc = await prisma.documento.findUnique({ where: { id }, select: { subidoPorId: true, userId: true } });
    if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });

    // Puede borrar: el OWNER, o quien lo subió (p.ej. el empleado su propio adjunto).
    const permitido = rol === "OWNER" || doc.subidoPorId === meId;
    if (!permitido) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    await prisma.documento.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});
