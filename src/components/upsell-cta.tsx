/**
 * `<UpsellCTA>` — bloque de upgrade visible cuando una feature está
 * fuera del plan actual. ADR-004 §2.7.
 *
 * Link a /admin/configuracion/facturacion?upgrade=KEY. La página de
 * facturación (Fase 4 commit 16) es server component que abre Stripe
 * Billing Portal.
 */

import Link from "next/link";

export function UpsellCTA({
  feature,
  message,
}: {
  feature: string;
  message?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--warning-bg)] bg-[var(--warning-bg)] p-4 text-[var(--warning-text)]">
      <p className="text-sm">
        {message ??
          "Esta función está disponible en planes superiores o como addon."}
      </p>
      <Link
        href={`/admin/configuracion/facturacion?upgrade=${encodeURIComponent(feature)}`}
        className="mt-2 inline-block text-sm font-medium text-[var(--warning-text)] hover:underline"
      >
        Ver opciones →
      </Link>
    </div>
  );
}
