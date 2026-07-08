import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
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
