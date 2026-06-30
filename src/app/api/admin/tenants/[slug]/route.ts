/**
 * GET /api/admin/tenants/[slug] — detalle + métricas básicas.
 * Plan Fase 7 §4.2.
 */

import { type NextRequest, NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";

export const GET = withSuperAdmin(async (
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) => {
  const sa = currentSuperAdmin();
  const meta = extractRequestMeta(req.headers);
  const { slug } = await params;
  const tenant = await prismaMaster.tenant.findUnique({
    where: { slug },
    include: {
      tenantFeatures: {
        select: {
          featureKey: true,
          value: true,
          source: true,
          expiresAt: true,
          reason: true,
        },
      },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          planKey: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          trialEnd: true,
        },
      },
      quotaUsage: {
        where: { periodEnd: { gt: new Date() } },
        select: {
          featureKey: true,
          consumed: true,
          max: true,
          periodEnd: true,
        },
      },
    },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  await writeAuditEntry({
    superAdminId: sa.id,
    action: "tenants:read",
    targetKind: "tenant",
    targetId: tenant.id,
    summary: { slug: tenant.slug },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  // BigInt serialization para quotaUsage.consumed/max.
  return NextResponse.json({
    tenant: {
      ...tenant,
      quotaUsage: tenant.quotaUsage.map((q) => ({
        ...q,
        consumed: Number(q.consumed),
        max: q.max === null ? null : Number(q.max),
      })),
    },
  });
});
