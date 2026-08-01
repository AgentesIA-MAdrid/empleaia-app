import { Pen } from "lucide-react";
import Link from "next/link";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";
import { NuevaSolicitudForm } from "./nueva-form";

async function NuevaSolicitudFirmaPage() {
  const [documentos, empleados] = await Promise.all([
    prismaApp.documento.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, nombre: true },
    }),
    prismaApp.user.findMany({
      where: { activo: true },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, apellidos: true, email: true },
    }),
  ]);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <header className="flex items-start gap-3">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <Pen className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            Nueva solicitud de firma
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            Selecciona un documento y el empleado que debe firmarlo.
          </p>
        </div>
      </header>

      <div className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-6">
        {documentos.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted,#94A3B8)]">
            Primero sube un documento desde Documentos.
          </p>
        ) : (
          <NuevaSolicitudForm documentos={documentos} empleados={empleados} />
        )}
      </div>

      <Link
        href="/admin/firma"
        className="inline-block text-sm text-[var(--color-text-body,#475569)] hover:text-[var(--primary)]"
      >
        ← Volver
      </Link>
    </div>
  );
}

export default withTenantPage(NuevaSolicitudFirmaPage);
