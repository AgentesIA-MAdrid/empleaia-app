/**
 * GET  /api/documentos/plantillas — lista de plantillas (OWNER/MANAGER).
 * POST /api/documentos/plantillas — crea una plantilla (OWNER/MANAGER).
 *
 * Body POST: { nombre, descripcion?, url?, tipo?, campos?, solicitarFirma? }.
 * Los campos son [{ label, tipo }] — se normalizan/validan server-side.
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

// Mismo límite que /api/documentos: ~7MB de data URL ≈ ~5MB de fichero.
const MAX_URL_LEN = 7_000_000;

function esGestor(rol: string): boolean {
  return rol === "OWNER" || rol === "MANAGER";
}

export const GET = withTenant(
  withFeature("documentos", async () => {
    try {
      const session = await auth();
      if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
      if (!esGestor((session.user as { rol?: string }).rol ?? "")) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
      const plantillas = await prisma.plantillaDocumento.findMany({
        include: { createdBy: { select: { nombre: true, apellidos: true } } },
        orderBy: [{ orden: "asc" }, { createdAt: "desc" }],
      });
      return NextResponse.json({ plantillas });
    } catch (error) {
      console.error("GET /api/documentos/plantillas error:", error);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  }),
);

export const POST = withTenant(
  withFeature("documentos", async (req: NextRequest) => {
    try {
      const session = await auth();
      if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
      const rol = (session.user as { rol?: string }).rol ?? "";
      const meId = (session.user as { id?: string }).id ?? "";
      if (!esGestor(rol)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

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

      const max = await prisma.plantillaDocumento.aggregate({ _max: { orden: true } });
      const plantilla = await prisma.plantillaDocumento.create({
        data: {
          nombre,
          descripcion: typeof body?.descripcion === "string" && body.descripcion ? body.descripcion : null,
          url,
          tipo: typeof body?.tipo === "string" && body.tipo ? body.tipo : "otro",
          campos: normalizarCampos(body?.campos) as unknown as Prisma.InputJsonValue,
          solicitarFirma: body?.solicitarFirma === true,
          orden: (max._max.orden ?? -1) + 1,
          createdById: meId,
        },
        include: { createdBy: { select: { nombre: true, apellidos: true } } },
      });
      return NextResponse.json({ plantilla }, { status: 201 });
    } catch (error) {
      console.error("POST /api/documentos/plantillas error:", error);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  }),
);
