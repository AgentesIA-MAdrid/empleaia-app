import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

/**
 * GET — devuelve el PDF data URL (el empleado dueño o admin). Marca vistoAt.
 * DELETE — admin elimina nómina.
 */
export const GET = withTenant(withFeature("envio_nominas", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  const { id } = await params;
  const nomina = await prisma.nominaArchivo.findUnique({ where: { id } });
  if (!nomina) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  // Solo administración abre la nómina de otra persona; el coordinador, la
  // suya (ticket 73).
  const esAdmin = userRol === Rol.OWNER;
  const esDueño = nomina.empleadoId === userId;
  if (!esAdmin && !esDueño) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (esDueño && !nomina.vistoAt) {
    await prisma.nominaArchivo.update({ where: { id }, data: { vistoAt: new Date() } });
  }
  return NextResponse.json({
    id: nomina.id, periodo: nomina.periodo, nombreArchivo: nomina.nombreArchivo,
    pdfUrl: nomina.pdfUrl, tamañoBytes: nomina.tamañoBytes,
  });
}));

export const DELETE = withTenant(withFeature("envio_nominas", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { id } = await params;
  await prisma.nominaArchivo.delete({ where: { id } });
  return NextResponse.json({ success: true });
}));
