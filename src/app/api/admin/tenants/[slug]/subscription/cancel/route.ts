/**
 * POST /api/admin/tenants/[slug]/subscription/cancel
 *
 * Marca como cancelada la última suscripción del tenant en la BD local.
 *
 * IMPORTANTE: esto NO cancela nada en Stripe. Si el cliente paga vía Stripe,
 * hay que cancelar la suscripción TAMBIÉN allí — de lo contrario seguirá
 * cobrando. Esta acción solo refleja el estado local.
 *
 * Tampoco cambia `Tenant.status`: suspender el acceso del tenant es una
 * acción aparte (POST .../suspend).
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
    | { motivo?: unknown }
    | null;
  const motivo = body?.motivo;

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
    select: { id: true, status: true },
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

  await prismaMaster.subscription.update({
    where: { id: subscription.id },
    data: { status: "canceled", cancelAtPeriodEnd: true },
  });

  await writeAuditEntry({
    superAdminId: sa.id,
    action: "subscription:cancel",
    targetKind: "subscription",
    targetId: subscription.id,
    summary: { slug, motivo, statusAnterior: subscription.status },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ ok: true });
});
