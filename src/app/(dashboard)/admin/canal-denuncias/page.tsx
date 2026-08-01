import { ShieldAlert, Plus } from "lucide-react";
import Link from "next/link";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";
import {
  CATEGORIA_LABEL,
  ESTADO_LABEL,
  ESTADO_TONE,
} from "@/lib/denuncias/categorias";
import { plazoAcuseRecibo, plazoResolucion } from "@/lib/denuncias/plazos";

async function CanalDenunciasPage() {
  const denuncias = await prismaApp.denuncia.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      asunto: true,
      categoria: true,
      estado: true,
      esAnonima: true,
      informanteNombre: true,
      createdAt: true,
      acuseReciboAt: true,
      resolucionAt: true,
    },
  });
  const now = new Date();

  const totalAbiertas = denuncias.filter(
    (d) => d.estado !== "resuelta" && d.estado !== "archivada",
  ).length;
  const totalSinAcuse = denuncias.filter((d) => !d.acuseReciboAt).length;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
            <ShieldAlert className="h-6 w-6 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
              Canal de denuncias
            </h1>
            <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
              Buzón confidencial · Cumple Ley 2/2023 (acuse en 7 días, resolución en 3 meses)
            </p>
          </div>
        </div>
        <Link
          href="/admin/canal-denuncias/nueva"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-4 py-2 text-sm font-semibold text-white shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Nueva denuncia
        </Link>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-4">
          <p className="text-xs font-medium text-[var(--color-text-muted,#94A3B8)] uppercase">Total</p>
          <p className="text-2xl font-bold mt-1 text-[var(--color-text-dark,#0F172A)]">{denuncias.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--warning-bg)] bg-[var(--warning-bg)] p-4">
          <p className="text-xs font-medium text-[var(--warning-text)] uppercase">Abiertas</p>
          <p className="text-2xl font-bold mt-1 text-[var(--warning-text)]">{totalAbiertas}</p>
        </div>
        <div className="rounded-lg border border-[var(--danger-bg)] bg-[var(--danger-bg)] p-4">
          <p className="text-xs font-medium text-[var(--danger-text)] uppercase">Pendientes de acuse</p>
          <p className="text-2xl font-bold mt-1 text-[var(--danger-text)]">{totalSinAcuse}</p>
        </div>
      </div>

      {denuncias.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-12 text-center">
          <ShieldAlert className="h-10 w-10 mx-auto text-[var(--text-muted)]" />
          <p className="mt-3 text-sm text-[var(--color-text-body,#475569)]">
            Aún no hay denuncias registradas en el canal.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] overflow-hidden">
          <table className="w-full">
            <thead className="bg-[var(--bg-subtle,#F8FAFC)] border-b border-[var(--color-border,#E2E8F0)]">
              <tr>
                {["Asunto", "Categoría", "Estado", "Acuse", "Resolución", "Recibida"].map((h) => (
                  <th
                    key={h}
                    className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-body,#475569)] px-4 py-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {denuncias.map((d) => {
                const acuse = d.acuseReciboAt
                  ? null
                  : plazoAcuseRecibo(d.createdAt, now);
                const resolucion =
                  d.resolucionAt
                    ? null
                    : plazoResolucion(d.createdAt, now);
                return (
                  <tr key={d.id} className="hover:bg-[var(--bg-subtle,#F8FAFC)] transition-colors">
                    <td className="px-4 py-3 max-w-xs">
                      <Link
                        href={`/admin/canal-denuncias/${d.id}`}
                        className="text-sm font-medium text-[var(--color-text-dark,#0F172A)] hover:text-[var(--primary)] hover:underline"
                      >
                        {d.asunto}
                      </Link>
                      <p className="text-xs text-[var(--color-text-muted,#94A3B8)] mt-0.5">
                        {d.esAnonima ? "Anónima" : d.informanteNombre ?? "Sin identificar"}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-body,#475569)]">
                      {CATEGORIA_LABEL[d.categoria]}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_TONE[d.estado]}`}>
                        {ESTADO_LABEL[d.estado]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {d.acuseReciboAt ? (
                        <span className="text-[var(--success-text)]">
                          ✓ {new Date(d.acuseReciboAt).toLocaleDateString("es-ES")}
                        </span>
                      ) : (
                        <span
                          className={
                            acuse?.level === "danger"
                              ? "text-[var(--danger-text)] font-medium"
                              : acuse?.level === "warning"
                                ? "text-[var(--warning-text)] font-medium"
                                : "text-[var(--color-text-muted,#94A3B8)]"
                          }
                        >
                          {acuse?.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {d.resolucionAt ? (
                        <span className="text-[var(--success-text)]">
                          ✓ {new Date(d.resolucionAt).toLocaleDateString("es-ES")}
                        </span>
                      ) : (
                        <span
                          className={
                            resolucion?.level === "danger"
                              ? "text-[var(--danger-text)] font-medium"
                              : resolucion?.level === "warning"
                                ? "text-[var(--warning-text)] font-medium"
                                : "text-[var(--color-text-muted,#94A3B8)]"
                          }
                        >
                          {resolucion?.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-body,#475569)] tabular-nums">
                      {new Date(d.createdAt).toLocaleDateString("es-ES")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default withTenantPage(CanalDenunciasPage);
