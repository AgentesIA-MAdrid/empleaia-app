import { Pen, Plus } from "lucide-react";
import Link from "next/link";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  firmada: "Firmada",
  rechazada: "Rechazada",
  expirada: "Expirada",
};

const ESTADO_TONE: Record<string, string> = {
  pendiente: "bg-[var(--warning-bg)] text-[var(--warning-text)]",
  firmada: "bg-[var(--success-bg)] text-[var(--success-text)]",
  rechazada: "bg-[var(--danger-bg)] text-[var(--danger-text)]",
  expirada: "bg-[var(--muted)] text-[var(--text-body)]",
};

async function FirmaPage() {
  const solicitudes = await prismaApp.solicitudFirma.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      documento: { select: { id: true, nombre: true } },
      destinatario: { select: { id: true, nombre: true, apellidos: true } },
      solicitadaPor: { select: { id: true, nombre: true, apellidos: true } },
      firma: { select: { firmadoEn: true } },
    },
  });

  const pendientes = solicitudes.filter((s) => s.estado === "pendiente").length;
  const firmadas = solicitudes.filter((s) => s.estado === "firmada").length;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
            <Pen className="h-6 w-6 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
              Firma electrónica
            </h1>
            <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
              Solicitudes de firma a empleados · Sello con hash SHA-256, IP y user-agent
            </p>
          </div>
        </div>
        <Link
          href="/admin/firma/nueva"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-4 py-2 text-sm font-semibold text-white shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Solicitar firma
        </Link>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-[var(--card)] p-4">
          <p className="text-xs font-medium text-[var(--text-muted)] uppercase">Total</p>
          <p className="text-2xl font-bold mt-1">{solicitudes.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--warning-bg)] bg-[var(--warning-bg)] p-4">
          <p className="text-xs font-medium text-[var(--warning-text)] uppercase">Pendientes</p>
          <p className="text-2xl font-bold mt-1 text-[var(--warning-text)]">{pendientes}</p>
        </div>
        <div className="rounded-lg border border-[var(--success-bg)] bg-[var(--success-bg)] p-4">
          <p className="text-xs font-medium text-[var(--success-text)] uppercase">Firmadas</p>
          <p className="text-2xl font-bold mt-1 text-[var(--success-text)]">{firmadas}</p>
        </div>
      </div>

      {solicitudes.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-[var(--card)] p-12 text-center">
          <Pen className="h-10 w-10 mx-auto text-[var(--text-muted)]" />
          <p className="mt-3 text-sm text-[var(--color-text-body,#475569)]">
            Aún no hay solicitudes de firma. Crea una para empezar.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-[var(--card)] overflow-hidden">
          <table className="w-full">
            <thead className="bg-[var(--bg-subtle,#F8FAFC)] border-b">
              <tr>
                {["Documento", "Destinatario", "Solicitada por", "Estado", "Creada", "Firmada"].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-body)] px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {solicitudes.map((s) => (
                <tr key={s.id} className="hover:bg-[var(--bg-subtle,#F8FAFC)]">
                  <td className="px-4 py-3 text-sm font-medium text-[var(--color-text-dark,#0F172A)]">
                    {s.documento.nombre}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {s.destinatario.nombre} {s.destinatario.apellidos}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-body)]">
                    {s.solicitadaPor.nombre} {s.solicitadaPor.apellidos}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_TONE[s.estado]}`}>
                      {ESTADO_LABEL[s.estado]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-body)] tabular-nums">
                    {new Date(s.createdAt).toLocaleDateString("es-ES")}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-body)] tabular-nums">
                    {s.firma?.firmadoEn ? new Date(s.firma.firmadoEn).toLocaleDateString("es-ES") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default withTenantPage(FirmaPage);
