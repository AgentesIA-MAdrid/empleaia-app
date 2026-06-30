/**
 * POST /api/admin/tenants/[slug]/subscription/extend
 *
 * Extiende el periodo de facturación de la última suscripción del tenant
 * sumando N días a `currentPeriodEnd`.
 *
 * IMPORTANTE: esto SOLO toca la BD local (master.Subscription). NO llama a
 * Stripe ni modifica nada en su lado. Si el cliente paga vía Stripe, el
 * periodo real de cobro lo dicta Stripe — esta extensión es para altas
 * manuales / cortesías administrativas.
 */

import { type NextRequest, NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";

export const POST = withSuperAdmin(async (
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) => {
  const sa = currentSuperAdmin();
  if (sa.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { slug } = await params;
  const meta = extractRequestMeta(req.headers);

  const body = (await req.json().catch(() => null)) as
    | { dias?: unknown; motivo?: unknown }
    | null;
  const dias = body?.dias;
  const motivo = body?.motivo;

  if (
    typeof dias !== "number" ||
    !Number.isInteger(dias) ||
    dias < 1 ||
    dias > 365
  ) {
    return NextResponse.json(
      { error: "El campo 'dias' debe ser un entero entre 1 y 365." },
      { status: 400 },
    );
  }
  if (typeof motivo !== "string" || motivo.trim().length < 10) {
    return NextResponse.json(
      { error: "El campo 'motivo' es obligatorio (mínimo 10 caracteres)." },
      { status: 400 },
    );
  }

  const tenant = await prismaMaster.tenant.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  const subscription = await prismaMaster.subscription.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
  });
  if (!subscription) {
    return NextResponse.json(
      {
        error:
          "El tenant no tiene una suscripción registrada (alta manual sin Stripe). No hay periodo que extender.",
      },
      { status: 409 },
    );
  }

  // Si el periodo ya venció, contar los días desde hoy (no desde el pasado).
  const now = new Date();
  const base =
    subscription.currentPeriodEnd && subscription.currentPeriodEnd > now
      ? subscription.currentPeriodEnd
      : now;
  const nuevoFin = new Date(base.getTime() + dias * 24 * 60 * 60 * 1000);

  const updated = await prismaMaster.subscription.update({
    where: { id: subscription.id },
    data: {
      currentPeriodEnd: nuevoFin,
      // Al extender, deja de estar marcada para cancelar al final del periodo.
      ...(subscription.cancelAtPeriodEnd ? { cancelAtPeriodEnd: false } : {}),
    },
    select: { currentPeriodEnd: true },
  });

  await writeAuditEntry({
    superAdminId: sa.id,
    action: "subscription:extend",
    targetKind: "subscription",
    targetId: subscription.id,
    summary: { slug, dias, motivo, nuevoFin: nuevoFin.toISOString() },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({
    ok: true,
    currentPeriodEnd: updated.currentPeriodEnd,
  });
});
