/**
 * /admin/facturacion/exito — landing post-Stripe Checkout success.
 *
 * Stripe redirige aquí tras un pago exitoso con `?session_id=cs_...`.
 * El webhook `checkout.session.completed` ya habrá actualizado el
 * tenant_features cuando esta página se renderice (o lo hará en
 * cuestión de segundos). Mostramos un mensaje optimista + CTA
 * para volver al dashboard.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ session_id?: string }>;
}

async function ExitoPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { session_id } = await searchParams;

  return (
    <div className="p-6 max-w-xl mx-auto">
      <div className="rounded-2xl border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--success-bg)]">
          <CheckCircle2 className="h-9 w-9 text-[var(--success)]" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-[var(--color-text-dark,#0F172A)]">
          ¡Pago confirmado!
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-body,#475569)]">
          Hemos recibido tu pago y estamos activando tu plan. Las nuevas
          funciones estarán disponibles en unos segundos.
        </p>
        {session_id && (
          <p className="mt-2 text-xs text-[var(--color-text-muted,#94A3B8)] font-mono break-all">
            Referencia: {session_id}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/admin"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors"
          >
            Ir al dashboard
          </Link>
          <Link
            href="/admin/planes"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] hover:bg-[var(--bg-subtle,#F8FAFC)] px-5 py-3 text-sm font-semibold text-[var(--color-text-dark,#0F172A)] transition-colors"
          >
            Ver planes
          </Link>
        </div>
      </div>
    </div>
  );
}

export default withTenantPage(ExitoPage as never);
