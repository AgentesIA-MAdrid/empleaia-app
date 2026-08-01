import { Briefcase } from "lucide-react";
import Link from "next/link";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { NuevaOfertaForm } from "./nueva-form";

async function NuevaOfertaPage() {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <header className="flex items-start gap-3">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <Briefcase className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            Nueva oferta
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            Define el puesto. Después podrás añadir candidatos al proceso.
          </p>
        </div>
      </header>

      <div className="rounded-lg border bg-[var(--card)] p-6">
        <NuevaOfertaForm />
      </div>

      <Link
        href="/admin/reclutamiento"
        className="inline-block text-sm text-[var(--color-text-body,#475569)] hover:text-[var(--primary)]"
      >
        ← Volver
      </Link>
    </div>
  );
}

export default withTenantPage(NuevaOfertaPage);
