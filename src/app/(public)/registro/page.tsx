/**
 * Página /registro. Vive en subdominio `app` (proxy.ts kind=app).
 * No usa withTenant (subdominio app no tiene tenant en contexto).
 */

import { prismaMaster } from "@/lib/prisma";
import { RegistroForm } from "./registro-form";
import { EmpleaIALogo } from "@/components/brand/empleaia-logo";

export const dynamic = "force-dynamic";

export default async function Page() {
  const planes = await prismaMaster.plan.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    select: { key: true, name: true, description: true },
  });
  return (
    <div className="min-h-screen bg-[var(--muted)]">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-60" />
        <div className="absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-50" />
      </div>

      <main className="relative max-w-xl mx-auto px-4 py-12">
        <div className="flex flex-col items-center mb-8">
          <EmpleaIALogo symbolSize={80} className="mb-4" />
          <p className="text-sm text-[var(--text-muted)]">Gestión inteligente de personal</p>
        </div>

        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-sm">
          <div className="px-8 py-8">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-[var(--text-dark)]">Crea tu cuenta</h1>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Completa los datos y te llevamos a Stripe para confirmar el pago. 14 días de prueba.
              </p>
            </div>
            <RegistroForm planes={planes} />
          </div>
        </div>
      </main>
    </div>
  );
}
