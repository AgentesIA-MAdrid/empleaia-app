import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

const createSchema = z.object({
  empleadoId: z.string().min(1),
  periodo: z.string().regex(/^\d{4}-\d{2}$/),
  pdfUrl: z.string().min(1).max(20_000_000), // data URL PDF (hasta ~15 MB)
  nombreArchivo: z.string().min(1).max(200),
  tamañoBytes: z.number().int().min(0).max(20_000_000),
});

export const GET = withTenant(withFeature("envio_nominas", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  const { searchParams } = req.nextUrl;
  const empleadoId = searchParams.get("empleadoId");
  const esAdmin = userRol === Rol.OWNER || userRol === Rol.MANAGER;
  const where: Record<string, unknown> = esAdmin
    ? (empleadoId ? { empleadoId } : {})
    : { empleadoId: userId };
  const nominas = await prisma.nominaArchivo.findMany({
    where,
    orderBy: { periodo: "desc" },
    select: {
      id: true, periodo: true, nombreArchivo: true, tamañoBytes: true,
      vistoAt: true, createdAt: true,
      empleado: { select: { id: true, nombre: true, apellidos: true } },
      subidoPor: { select: { id: true, nombre: true, apellidos: true } },
    },
  });
  return NextResponse.json({ nominas });
}));

export const POST = withTenant(withFeature("envio_nominas", async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const userRol = (session.user as { rol?: Rol }).rol;
  if (userRol !== Rol.OWNER) return NextResponse.json({ error: "Solo el Administrador" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    const nomina = await prisma.nominaArchivo.create({
      data: { ...parsed.data, subidoPorId: userId },
      select: {
        id: true, periodo: true, nombreArchivo: true, tamañoBytes: true, createdAt: true,
        empleado: { select: { id: true, nombre: true, apellidos: true } },
      },
    });
    return NextResponse.json({ nomina }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && /unique/i.test(e.message)) {
      return NextResponse.json({ error: "Ya existe una nómina para ese empleado/periodo" }, { status: 409 });
    }
    throw e;
  }
}));
