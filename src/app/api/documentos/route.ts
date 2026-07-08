import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

// Límite del fichero cuando se sube como data URL (se guarda en `url`, texto en
// BD). ~7MB de cadena base64 ≈ ~5MB de fichero. Suficiente para nóminas/PDF.
const MAX_URL_LEN = 7_000_000;

export const GET = withTenant(withFeature("documentos", async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = (session.user as any).id as string;
    const rol = (session.user as any).rol as string;

    // EMPLEADO: solo los suyos. OWNER/MANAGER: todos, o los de un empleado
    // concreto si viene ?userId= (para la pestaña de la ficha del empleado).
    const filtroUserId = req.nextUrl.searchParams.get("userId");
    const where =
      rol === "EMPLEADO"
        ? { userId }
        : filtroUserId
          ? { userId: filtroUserId }
          : {};

    const documentos = await prisma.documento.findMany({
      where,
      include: {
        user: { select: { nombre: true, apellidos: true } },
        subidoPor: { select: { nombre: true, apellidos: true } },
        solicitudesFirma: { select: { id: true, estado: true, destinatarioId: true } },
        firmas: { select: { id: true, userId: true, firmadoEn: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ documentos });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));

export const POST = withTenant(withFeature("documentos", async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as any).rol as string;
    const meId = (session.user as any).id as string;

    const body = await req.json();
    const { nombre, descripcion, url, tipo, userId } = body;
    if (!nombre) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    if (typeof url === "string" && url.length > MAX_URL_LEN) {
      return NextResponse.json({ error: "El archivo es demasiado grande (máx ~5 MB)." }, { status: 400 });
    }

    // EMPLEADO: solo puede adjuntar documentos PARA SÍ MISMO (userId forzado a
    // su propio id). OWNER/MANAGER: pueden enviar documentos a cualquier
    // empleado (userId del body) o generales (null).
    const destinatarioId = rol === "EMPLEADO" ? meId : (userId || null);

    const documento = await prisma.documento.create({
      data: {
        nombre,
        descripcion: descripcion || null,
        url: url || null,
        tipo: tipo || "otro",
        userId: destinatarioId,
        subidoPorId: meId,
      },
      include: {
        user: { select: { nombre: true, apellidos: true } },
        subidoPor: { select: { nombre: true, apellidos: true } },
      },
    });

    return NextResponse.json({ documento }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));
