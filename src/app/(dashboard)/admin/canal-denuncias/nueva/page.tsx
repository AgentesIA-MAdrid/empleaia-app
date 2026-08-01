import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { NuevaDenunciaForm } from "./nueva-form";

async function NuevaDenunciaPage() {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <header className="flex items-start gap-3">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <ShieldAlert className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            Nueva denuncia
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            Confidencial · Tu identidad solo será visible para el comité del canal.
            Puedes denunciar de forma anónima si lo prefieres.
          </p>
        </div>
      </header>

      <div className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-6">
        <NuevaDenunciaForm />
      </div>

      <Link
        href="/admin/canal-denuncias"
        className="inline-block text-sm text-[var(--color-text-body,#475569)] hover:text-[var(--primary)]"
      >
        ← Volver al canal
      </Link>
    </div>
  );
}

export default withTenantPage(NuevaDenunciaPage);
