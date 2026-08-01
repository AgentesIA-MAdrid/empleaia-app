/**
 * /admin/facturacion/cancelado — landing post-Stripe Checkout cancel.
 *
 * Stripe redirige aquí cuando el usuario abandona el checkout sin
 * completarlo. El plan no cambió. CTA para volver a la pantalla de
 * planes y reintentar.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { XCircle } from "lucide-react";
import { auth } from "@/lib/auth";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";

export const dynamic = "force-dynamic";

async function CanceladoPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="p-6 max-w-xl mx-auto">
      <div className="rounded-2xl border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--muted)]">
          <XCircle className="h-9 w-9 text-[var(--text-muted)]" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-[var(--color-text-dark,#0F172A)]">
          Pago cancelado
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-body,#475569)]">
          No te preocupes — tu plan no ha cambiado y no se ha cargado nada a
          tu tarjeta.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/admin/planes"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors"
          >
            Volver a planes
          </Link>
          <Link
            href="/admin"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] hover:bg-[var(--bg-subtle,#F8FAFC)] px-5 py-3 text-sm font-semibold text-[var(--color-text-dark,#0F172A)] transition-colors"
          >
            Ir al dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

export default withTenantPage(CanceladoPage as never);
