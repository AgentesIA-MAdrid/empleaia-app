/**
 * GET /api/informes — devuelve JSON del informe solicitado.
 *
 * Thin wrapper sobre `getInformeData()` (src/lib/informes/queries.ts).
 * Toda la lógica de queries Prisma vive en el módulo compartido para
 * poder ser invocada también por /api/informes/exportar SIN fetch
 * interno entre rutas Next (FIX 3 cierre Fase 5).
 */

import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import type { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { hasFeature } from "@/lib/tenant/features";
import {
  getInformeData,
  type InformeTipo,
} from "@/lib/informes/queries";

/**
 * Tipos de informe que requieren la feature `informes_avanzados`.
 * Los básicos (`fichajes`, `presencia`) están disponibles en todos los
 * planes — necesarios para cumplir RD 8/2019 y mostrar el estado
 * actual de la plantilla.
 */
const TIPOS_AVANZADOS: ReadonlySet<InformeTipo> = new Set<InformeTipo>([
  "ausencias",
  "turnos",
  "resumen",
  "presencia-global",
  // Los retrasos son análisis agregado, igual que el resumen: sin esto un plan
  // sin `informes_avanzados` los tendría por la puerta de atrás.
  "retrasos",
  "discrepancias",
]);

export const GET = withTenant(async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { searchParams } = request.nextUrl;
    const tipo = (searchParams.get("tipo") as InformeTipo) ?? "fichajes";

    if (TIPOS_AVANZADOS.has(tipo) && !hasFeature("informes_avanzados")) {
      return NextResponse.json(
        {
          error: "feature_required",
          feature_key: "informes_avanzados",
          upgrade_url: `/admin/planes?upgrade=informes_avanzados`,
        },
        { status: 402 },
      );
    }

    const result = await getInformeData({
      tipo,
      fechaInicio: searchParams.get("fechaInicio"),
      fechaFin: searchParams.get("fechaFin"),
      tiendaId: searchParams.get("tiendaId"),
      userId: searchParams.get("userId"),
      fecha: searchParams.get("fecha"),
      userRol: (session.user as { rol: Rol }).rol,
      userTiendaId:
        (session.user as { tiendaId: string | null }).tiendaId ?? null,
      sessionUserId: session.user.id!,
      prisma: prismaApp,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data);
  } catch (error) {
    console.error("GET /api/informes error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
});
