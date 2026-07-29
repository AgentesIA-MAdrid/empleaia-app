/**
 * Checklist de fichaje — catálogo de puntos de control (ticket c4bc33d6).
 *
 *  - GET  → lo consulta el empleado antes de fichar (solo puntos activos)
 *           y el OWNER para editarlo (`?todos=1` incluye los desactivados).
 *  - PUT  → OWNER: activa/desactiva el checklist y reemplaza el catálogo.
 *
 * El histórico de confirmaciones vive en `FichajeChecklist` y guarda el
 * enunciado en snapshot, así que borrar un item aquí no rompe registros
 * anteriores (la FK es ON DELETE SET NULL).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { normalizarItems, TIPOS_CON_CHECKLIST } from "@/lib/fichajes/checklist";

export const GET = withTenant(async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const esOwner = (session.user as { rol?: string }).rol === "OWNER";
    const todos = new URL(req.url).searchParams.get("todos") === "1" && esOwner;

    const [config, items] = await Promise.all([
      prisma.configuracionEmpresa.findUnique({
        where: { id: "singleton" },
        select: { checklistFichajeActivo: true },
      }),
      prisma.checklistFichajeItem.findMany({
        where: {
          tipo: { in: [...TIPOS_CON_CHECKLIST] },
          ...(todos ? {} : { activo: true }),
        },
        orderBy: [{ tipo: "asc" }, { orden: "asc" }],
        select: { id: true, tipo: true, texto: true, orden: true, activo: true },
      }),
    ]);

    return NextResponse.json({
      activo: config?.checklistFichajeActivo === true,
      items,
    });
  } catch (error) {
    console.error("GET /api/checklist-fichaje error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});

export const PUT = withTenant(async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if ((session.user as { rol?: string }).rol !== "OWNER") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = (await req.json()) as { activo?: unknown; items?: unknown };

    const normalizados = normalizarItems(body.items ?? []);
    if (!normalizados.ok) {
      return NextResponse.json({ error: normalizados.error }, { status: 400 });
    }

    if ("activo" in body && typeof body.activo !== "boolean") {
      return NextResponse.json({ error: "activo debe ser booleano" }, { status: 400 });
    }

    if (typeof body.activo === "boolean") {
      await prisma.configuracionEmpresa.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", checklistFichajeActivo: body.activo },
        update: { checklistFichajeActivo: body.activo },
      });
    }

    // Reemplazo del catálogo: los que ya no vienen se borran (sus
    // confirmaciones históricas conservan el texto), el resto se
    // actualiza o se crea respetando el orden recibido.
    const conservados = normalizados.items
      .map((i) => i.id)
      .filter((id): id is string => id !== null);

    await prisma.$transaction(async (tx) => {
      await tx.checklistFichajeItem.deleteMany({
        where: {
          tipo: { in: [...TIPOS_CON_CHECKLIST] },
          ...(conservados.length > 0 ? { id: { notIn: conservados } } : {}),
        },
      });

      for (const item of normalizados.items) {
        const data = {
          tipo: item.tipo,
          texto: item.texto,
          orden: item.orden,
          activo: item.activo,
        };
        if (item.id) {
          await tx.checklistFichajeItem.upsert({
            where: { id: item.id },
            create: { id: item.id, ...data },
            update: data,
          });
        } else {
          await tx.checklistFichajeItem.create({ data });
        }
      }
    });

    const [config, items] = await Promise.all([
      prisma.configuracionEmpresa.findUnique({
        where: { id: "singleton" },
        select: { checklistFichajeActivo: true },
      }),
      prisma.checklistFichajeItem.findMany({
        where: { tipo: { in: [...TIPOS_CON_CHECKLIST] } },
        orderBy: [{ tipo: "asc" }, { orden: "asc" }],
        select: { id: true, tipo: true, texto: true, orden: true, activo: true },
      }),
    ]);

    return NextResponse.json({
      activo: config?.checklistFichajeActivo === true,
      items,
    });
  } catch (error) {
    console.error("PUT /api/checklist-fichaje error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
});
