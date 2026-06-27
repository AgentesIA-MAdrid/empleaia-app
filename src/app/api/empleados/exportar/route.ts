/**
 * GET /api/empleados/exportar?formato={xlsx|pdf}&tiendaId=&rol=
 *
 * Exporta el directorio de empleados del tenant a Excel o PDF. Mismo
 * modelo que `/api/informes/exportar` (ticket "exportar empleados"):
 * feature-gated por formato + consume la quota mensual de exports +
 * genera el archivo real reutilizando `src/lib/informes/generators`.
 *
 * Orden inviolable §15.6: withTenant → check feature → consume quota →
 * handler. El feature key (`export_excel` | `export_pdf`) depende del
 * query param `formato`, así que el check es inline (no `withFeature`),
 * igual que en informes.
 *
 * Datos: query directa con `prismaApp` (mismo scope/rol que el GET de
 * `/api/empleados`). NO fetch interno entre rutas (AGENTS.md).
 */

import { auth } from "@/lib/auth";
import { hasFeature, consumeQuota } from "@/lib/tenant/features";
import { prismaApp } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextResponse, type NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { generarExcel, generarPDF } from "@/lib/informes/generators";
import { resolveEmpresaScope } from "@/lib/multi-empresa/scope";
import { getLabelRol } from "@/lib/utils";

const FORMATO_TO_FEATURE: Record<string, string> = {
  xlsx: "export_excel",
  pdf: "export_pdf",
};

function secondsUntil(date: Date, now: Date = new Date()): number {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1000));
}

function mimeTypeFor(formato: string): string {
  if (formato === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (formato === "pdf") return "application/pdf";
  return "application/octet-stream";
}

export const GET = withTenant(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const userRol = (session.user as { rol: Rol }).rol;
  if (userRol !== Rol.OWNER && userRol !== Rol.MANAGER) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const formato = searchParams.get("formato") ?? "xlsx";
  const featureKey = FORMATO_TO_FEATURE[formato];
  if (!featureKey) {
    return NextResponse.json(
      { error: "formato_invalido", allowed: Object.keys(FORMATO_TO_FEATURE) },
      { status: 400 },
    );
  }

  if (!hasFeature(featureKey)) {
    return NextResponse.json(
      {
        error: "feature_required",
        feature_key: featureKey,
        upgrade_url: `/admin/configuracion/facturacion?upgrade=${encodeURIComponent(featureKey)}`,
      },
      { status: 402 },
    );
  }

  const consumeResult = await consumeQuota("exports_mes", 1);
  if (!consumeResult.ok) {
    if (consumeResult.reason === "period_unavailable") {
      return NextResponse.json(
        { error: "period_unavailable", feature_key: "exports_mes" },
        { status: 429, headers: { "Retry-After": "30" } },
      );
    }
    return NextResponse.json(
      {
        error: "limit_reached",
        feature_key: "exports_mes",
        used: consumeResult.used,
        max: consumeResult.max,
        resetAt: consumeResult.resetAt.toISOString(),
        upgrade_url: "/admin/configuracion/facturacion?upgrade=exports_mes",
      },
      {
        status: 429,
        headers: { "Retry-After": String(secondsUntil(consumeResult.resetAt)) },
      },
    );
  }

  // Filtros estructurados (mismos que el GET de /api/empleados). El
  // buscador de texto libre es client-only y no se aplica aquí.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  const tiendaId = searchParams.get("tiendaId");
  const rol = searchParams.get("rol") as Rol | null;

  if (userRol === Rol.OWNER) {
    if (tiendaId) where.tiendaId = tiendaId;
  } else {
    // MANAGER solo ve su tienda.
    where.tiendaId = (session.user as { tiendaId: string | null }).tiendaId ?? null;
  }
  if (rol && Object.values(Rol).includes(rol)) {
    where.rol = rol;
  }

  // Aislamiento multi_empresa (igual que el GET de /api/empleados).
  const scope = await resolveEmpresaScope(session);
  if (scope.empresaId) where.empresaId = scope.empresaId;

  const empleados = await prismaApp.user.findMany({
    where,
    select: {
      nombre: true,
      apellidos: true,
      email: true,
      dni: true,
      telefono: true,
      rol: true,
      horasSemanalesContrato: true,
      activo: true,
      password: true,
      tienda: { select: { nombre: true } },
      sedes: {
        select: { principal: true, tienda: { select: { nombre: true } } },
      },
    },
    orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
  });

  // Filas planas y legibles (sin password/tokens). Las claves son los
  // encabezados que verá el archivo.
  const rows = empleados.map((e) => {
    const sedePrincipal =
      e.sedes.find((s) => s.principal)?.tienda.nombre ??
      e.sedes[0]?.tienda.nombre ??
      e.tienda?.nombre ??
      "";
    const estado = !e.password
      ? "Invitación pendiente"
      : e.activo
        ? "Activo"
        : "Inactivo";
    return {
      Nombre: e.nombre,
      Apellidos: e.apellidos,
      Email: e.email,
      DNI: e.dni ?? "",
      Teléfono: e.telefono ?? "",
      Rol: getLabelRol(e.rol),
      Sede: sedePrincipal,
      Estado: estado,
      "Horas semanales":
        e.horasSemanalesContrato == null ? "" : String(e.horasSemanalesContrato),
    };
  });

  const payload = { tipo: "empleados", empleados: rows };
  const fechaSlug = new Date().toISOString().slice(0, 10);
  const filename = `empleados_${fechaSlug}.${formato}`;

  if (formato === "xlsx") {
    const buf = await generarExcel(payload);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mimeTypeFor("xlsx"),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.length),
      },
    });
  }
  // pdf
  const buf = generarPDF(payload);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": mimeTypeFor("pdf"),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
    },
  });
});
