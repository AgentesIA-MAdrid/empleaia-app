/**
 * POST /api/documentos/plantillas/[id]/enviar — envía una plantilla a uno o
 * varios empleados (OWNER/MANAGER). Body: { userIds: string[] }.
 *
 * Cada envío materializa un `Documento` para el empleado (ver `enviarPlantilla`).
 * Si la plantilla exige firma pero no tiene archivo adjunto, se rechaza: sin
 * archivo el empleado no podría firmarlo.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { isSafeDocUrl } from "@/lib/documentos/url";
import { esCarpetaFirmaObligatoria } from "@/lib/documentos/categorias";
import { enviarPlantilla } from "@/lib/documentos/plantillas";

export const POST = withTenant(
  withFeature("documentos", async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await auth();
      if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
      const rol = (session.user as { rol?: string }).rol ?? "";
      const meId = (session.user as { id?: string }).id ?? "";
      if (rol !== "OWNER" && rol !== "MANAGER") {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }

      const { id } = await params;
      const plantilla = await prisma.plantillaDocumento.findUnique({ where: { id } });
      if (!plantilla) return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });

      const body = await req.json().catch(() => null);
      const rawIds: unknown = body?.userIds;
      const userIds = Array.isArray(rawIds)
        ? [...new Set(rawIds.filter((u): u is string => typeof u === "string" && !!u))]
        : [];
      if (userIds.length === 0) {
        return NextResponse.json({ error: "Elige al menos un empleado destinatario." }, { status: 400 });
      }

      // Si la plantilla pide firma (o es de la carpeta de contratos) necesita
      // archivo para que el empleado pueda firmarlo.
      const requiereFirma = plantilla.solicitarFirma || esCarpetaFirmaObligatoria(plantilla.tipo);
      if (requiereFirma && !isSafeDocUrl(plantilla.url)) {
        return NextResponse.json(
          { error: "La plantilla necesita un archivo adjunto para poder solicitar la firma." },
          { status: 400 },
        );
      }

      // Solo destinatarios reales del tenant (evita IDs inventados).
      const validos = await prisma.user.findMany({
        where: { id: { in: userIds }, anonimizadoAt: null },
        select: { id: true },
      });
      const validIds = new Set(validos.map((u) => u.id));

      let enviados = 0;
      let firmasSolicitadas = 0;
      for (const userId of userIds) {
        if (!validIds.has(userId)) continue;
        const res = await enviarPlantilla({
          plantilla,
          destinatarioId: userId,
          solicitadaPorId: meId,
        });
        enviados += 1;
        if (res.firmaSolicitada) firmasSolicitadas += 1;
      }

      return NextResponse.json({ enviados, firmasSolicitadas }, { status: 201 });
    } catch (error) {
      console.error("POST /api/documentos/plantillas/[id]/enviar error:", error);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  }),
);
