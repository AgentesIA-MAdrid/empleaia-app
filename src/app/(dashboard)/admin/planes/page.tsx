/**
 * /admin/planes — pantalla privada del OWNER del tenant para ver los 3
 * planes y cambiar de uno a otro vía Stripe Checkout.
 *
 * Server component: lee plan actual del tenant + número de empleados
 * activos desde Prisma. La parte interactiva (modal + click → API)
 * vive en `<PlanesGrid>` (client component).
 *
 * Acceso: solo OWNER. No-OWNER → 401 visible.
 */

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { currentTenant } from "@/lib/tenant/context";
import { prismaApp, prismaMaster } from "@/lib/prisma";
import { PlanesGrid } from "@/components/admin/planes-grid";
import type { PlanKey } from "@/lib/billing/plan-pricing";

export const dynamic = "force-dynamic";

async function PlanesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const rol = (session.user as { rol?: string }).rol;
  if (rol !== "OWNER") {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-[var(--color-text-dark,#0F172A)]">
          Acceso restringido
        </h1>
        <p className="text-sm text-[var(--color-text-body,#475569)] mt-2">
          Solo el OWNER puede gestionar el plan y la facturación.
        </p>
      </div>
    );
  }

  const ctx = currentTenant();

  const [empleadosActivos, latestSub] = await Promise.all([
    prismaApp.user.count({ where: { activo: true } }),
    prismaMaster.subscription.findFirst({
      where: {
        tenantId: ctx.tenantId,
        status: { in: ["active", "trialing", "past_due"] },
      },
      orderBy: { createdAt: "desc" },
      select: { planKey: true, status: true },
    }),
  ]);

  const currentPlan: PlanKey | null =
    latestSub && ["starter", "pro", "enterprise"].includes(latestSub.planKey)
      ? (latestSub.planKey as PlanKey)
      : null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <header className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
          Planes y precios
        </h1>
        <p className="text-base text-[var(--color-text-body,#475569)] mt-2">
          Elige el plan que mejor se ajusta a tu empresa. Puedes cambiar o
          cancelar en cualquier momento.
        </p>
        {currentPlan === null && (
          <p className="mt-3 inline-flex items-center rounded-full bg-[var(--warning-bg)] px-3 py-1 text-xs font-medium text-[var(--warning-text)] ring-1 ring-amber-200">
            No tienes un plan activo todavía. Activa uno para empezar.
          </p>
        )}
      </header>

      <PlanesGrid currentPlan={currentPlan} empleadosActivos={empleadosActivos} />

      <footer className="text-center text-xs text-[var(--color-text-muted,#94A3B8)] space-y-1 pt-4">
        <p>
          Los precios mostrados <strong>no incluyen IVA</strong>.
        </p>
        <p>
          El cambio de plan es <strong>inmediato</strong>. Se prorratea
          proporcionalmente con tu ciclo de facturación actual.
        </p>
      </footer>
    </div>
  );
}

export default withTenantPage(PlanesPage as never);
