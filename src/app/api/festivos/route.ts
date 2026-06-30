import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { festivoAplicaA } from "@/lib/ausencias/festivos";

export const GET = withTenant(async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const scope = new URL(req.url).searchParams.get("scope");

    // scope=me → solo los festivos que aplican al usuario actual (nacional +
    // locales de su sede, descontando sus excepciones). No expone las
    // excepciones de otros empleados. Lo usan los calendarios de manager y
    // empleado.
    if (scope === "me") {
      const tiendaId = (session.user as { tiendaId?: string | null }).tiendaId ?? null;
      const todos = await prisma.festivo.findMany({
        orderBy: { fecha: "asc" },
        include: {
          tienda: { select: { id: true, nombre: true } },
          excepciones: { select: { userId: true } },
        },
      });
      const festivos = todos
        .filter((f) => festivoAplicaA(f, { id: session.user!.id ?? "", tiendaId }))
        .map((f) => ({
          id: f.id,
          nombre: f.nombre,
          fecha: f.fecha,
          ambito: f.ambito,
          tiendaId: f.tiendaId,
          tienda: f.tienda,
        }));
      return NextResponse.json({ festivos });
    }

    // Por defecto (admin): todos los festivos con su sede y sus excepciones,
    // para poder mostrarlos y editarlos en el calendario.
    const festivos = await prisma.festivo.findMany({
      orderBy: { fecha: "asc" },
      include: {
        tienda: { select: { id: true, nombre: true } },
        excepciones: { select: { userId: true } },
      },
    });

    return NextResponse.json({ festivos });
  } catch (error) {
    console.error("GET /api/festivos error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});

export const POST = withTenant(async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as { rol?: string }).rol;
    if (rol !== "OWNER") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const body = await req.json();
    const { nombre, fecha, ambito, tiendaId } = body as {
      nombre?: string;
      fecha?: string;
      ambito?: string;
      tiendaId?: string | null;
    };
    if (!nombre || !fecha) return NextResponse.json({ error: "Faltan campos" }, { status: 400 });

    const ambitoFinal = ambito === "local" ? "local" : "nacional";
    // Un festivo local debe ir ligado a una sede; uno nacional nunca.
    if (ambitoFinal === "local" && !tiendaId) {
      return NextResponse.json({ error: "Un festivo local requiere una sede" }, { status: 400 });
    }
    const tiendaIdFinal = ambitoFinal === "local" ? tiendaId! : null;

    const fechaDate = new Date(fecha);
    if (Number.isNaN(fechaDate.getTime())) {
      return NextResponse.json(
        { error: "fecha_invalid", reason: "no parseable" },
        { status: 400 },
      );
    }
    const festivo = await prisma.festivo.create({
      data: { nombre, fecha: fechaDate, ambito: ambitoFinal, tiendaId: tiendaIdFinal },
    });

    return NextResponse.json({ festivo }, { status: 201 });
  } catch (error) {
    console.error("POST /api/festivos error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});

export const DELETE = withTenant(async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as { rol?: string }).rol;
    if (rol !== "OWNER") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 });

    await prisma.festivo.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/festivos error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});
