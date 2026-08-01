import { ScanFace, CheckCircle2 } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";
import { TemplateActions } from "./template-actions";

async function FaceIDPage() {
  const empleados = await prismaApp.user.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      apellidos: true,
      email: true,
      faceTemplate: {
        select: {
          id: true,
          createdAt: true,
          consentimientoAt: true,
          algoritmo: true,
        },
      },
    },
  });

  const conTemplate = empleados.filter((e) => e.faceTemplate).length;
  const sinTemplate = empleados.length - conTemplate;

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <ScanFace className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            Face ID
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            Reconocimiento facial para validar identidad al fichar · Embeddings cifrados AES-256-GCM
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-[var(--card)] p-4">
          <p className="text-xs font-medium text-[var(--text-muted)] uppercase">Empleados activos</p>
          <p className="text-2xl font-bold mt-1">{empleados.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--success-bg)] bg-[var(--success-bg)] p-4">
          <p className="text-xs font-medium text-[var(--success-text)] uppercase">Con Face ID</p>
          <p className="text-2xl font-bold mt-1 text-[var(--success-text)]">{conTemplate}</p>
        </div>
        <div className="rounded-lg border border-[var(--warning-bg)] bg-[var(--warning-bg)] p-4">
          <p className="text-xs font-medium text-[var(--warning-text)] uppercase">Sin Face ID</p>
          <p className="text-2xl font-bold mt-1 text-[var(--warning-text)]">{sinTemplate}</p>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 text-sm text-[var(--text-body)]">
        <p>
          <strong>GDPR · datos biométricos.</strong> El embedding facial (vector de 128 valores
          numéricos) se cifra con AES-256-GCM antes de persistirse. No se almacena ninguna foto.
          El proceso de captura se ejecuta en el dispositivo del empleado (face-api.js en
          navegador) y requiere consentimiento explícito.
        </p>
      </div>

      <div className="rounded-lg border bg-[var(--card)] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--bg-subtle,#F8FAFC)] border-b">
            <tr>
              {["Empleado", "Email", "Face ID", "Registrada", "Acciones"].map((h) => (
                <th key={h} className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-body)] px-4 py-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {empleados.map((e) => (
              <tr key={e.id} className="hover:bg-[var(--bg-subtle,#F8FAFC)]">
                <td className="px-4 py-3 text-sm font-medium">
                  {e.nombre} {e.apellidos}
                </td>
                <td className="px-4 py-3 text-sm text-[var(--text-body)]">{e.email}</td>
                <td className="px-4 py-3">
                  {e.faceTemplate ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--success-text)]">
                      <CheckCircle2 className="h-3 w-3" />
                      Registrada
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-[var(--muted)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-body)]">
                      Sin registrar
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-[var(--text-body)] tabular-nums">
                  {e.faceTemplate
                    ? new Date(e.faceTemplate.createdAt).toLocaleDateString("es-ES")
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  {e.faceTemplate ? (
                    <TemplateActions userId={e.id} />
                  ) : (
                    <span className="text-xs text-[var(--text-muted)] italic">El empleado se registra desde su portal</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default withTenantPage(FaceIDPage);
