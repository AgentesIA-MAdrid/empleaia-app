/**
 * PUT    /api/documentos/plantillas/[id] — edita una plantilla (OWNER/MANAGER).
 * DELETE /api/documentos/plantillas/[id] — elimina una plantilla (OWNER/MANAGER).
 *
 * Borrar una plantilla NO afecta a los documentos ya enviados a empleados: son
 * copias independientes (`Documento`).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { isSafeDocUrl } from "@/lib/documentos/url";
import { normalizarCampos } from "@/lib/documentos/campos";

const MAX_URL_LEN = 7_000_000;

function esGestor(rol: string): boolean {
  return rol === "OWNER" || rol === "MANAGER";
}

export const PUT = withTenant(
  withFeature("documentos", async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await auth();
      if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
      if (!esGestor((session.user as { rol?: string }).rol ?? "")) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
      const { id } = await params;
      const existe = await prisma.plantillaDocumento.findUnique({ where: { id }, select: { id: true } });
      if (!existe) return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });

      const body = await req.json().catch(() => null);
      const nombre = typeof body?.nombre === "string" ? body.nombre.trim() : "";
      if (!nombre) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });

      const url = typeof body?.url === "string" && body.url ? body.url : null;
      if (url && url.length > MAX_URL_LEN) {
        return NextResponse.json({ error: "El archivo es demasiado grande (máx ~5 MB)." }, { status: 400 });
      }
      if (url && !isSafeDocUrl(url)) {
        return NextResponse.json({ error: "Tipo de archivo/URL no permitido." }, { status: 400 });
      }

      const plantilla = await prisma.plantillaDocumento.update({
        where: { id },
        data: {
          nombre,
          descripcion: typeof body?.descripcion === "string" && body.descripcion ? body.descripcion : null,
          url,
          tipo: typeof body?.tipo === "string" && body.tipo ? body.tipo : "otro",
          campos: normalizarCampos(body?.campos) as unknown as Prisma.InputJsonValue,
          solicitarFirma: body?.solicitarFirma === true,
        },
        include: { createdBy: { select: { nombre: true, apellidos: true } } },
      });
      return NextResponse.json({ plantilla });
    } catch (error) {
      console.error("PUT /api/documentos/plantillas/[id] error:", error);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  }),
);

export const DELETE = withTenant(
  withFeature("documentos", async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await auth();
      if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
      if (!esGestor((session.user as { rol?: string }).rol ?? "")) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
      const { id } = await params;
      const existe = await prisma.plantillaDocumento.findUnique({ where: { id }, select: { id: true } });
      if (!existe) return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
      await prisma.plantillaDocumento.delete({ where: { id } });
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("DELETE /api/documentos/plantillas/[id] error:", error);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  }),
);
