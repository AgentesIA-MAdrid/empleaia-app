"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, FileText, AlertTriangle, AlertOctagon, Info } from "lucide-react";

interface AuditEntry {
  id: string;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  severity: "info" | "warning" | "critical";
  superAdminId: string | null;
  superAdminEmail?: string | null;
  details?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

interface ApiResponse {
  items: AuditEntry[];
  total: number;
}

const SEVERITY_TONE: Record<AuditEntry["severity"], string> = {
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  warning: "bg-[var(--warning-bg)] text-[var(--warning-text)] ring-amber-200",
  critical: "bg-[var(--danger-bg)] text-[var(--danger-text)] ring-red-200",
};

const SEVERITY_ICON: Record<AuditEntry["severity"], typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertOctagon,
};

const SEVERITY_FILTERS = [
  { value: "", label: "Todas" },
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
] as const;

export default function AuditLogPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string>("");

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (severity) p.set("severity", severity);
    p.set("limit", "100");
    return p.toString();
  }, [severity]);

  useEffect(() => {
    let stopped = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/admin/audit-log?${queryString}`);
        if (r.status === 401) {
          window.location.href = "/admin/login";
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (!stopped) setData((await r.json()) as ApiResponse);
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : "Error de red");
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [queryString]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
          Audit log
        </h1>
        <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
          {data ? `${data.total} entrada${data.total === 1 ? "" : "s"} registrada${data.total === 1 ? "" : "s"}` : "Cargando…"}
        </p>
      </header>

      <div className="flex gap-1 bg-[var(--muted)] p-1 rounded-lg w-fit">
        {SEVERITY_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setSeverity(f.value)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              severity === f.value
                ? "bg-[var(--card)] text-[var(--color-text-dark,#0F172A)] shadow-sm"
                : "text-[var(--color-text-body,#475569)] hover:text-[var(--color-text-dark,#0F172A)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-[var(--card)] border border-[var(--color-border,#E2E8F0)] rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--color-text-body,#475569)]">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Cargando entradas…
          </div>
        ) : error ? (
          <div className="px-4 py-3 text-sm text-[var(--danger-text)] bg-[var(--danger-bg)]">{error}</div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-16 text-center text-[var(--color-text-muted,#94A3B8)]">
            <FileText className="h-10 w-10 mx-auto mb-2 text-slate-200" />
            <p className="text-sm">Sin entradas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--bg-subtle,#F8FAFC)] border-b border-[var(--color-border,#E2E8F0)]">
                <tr>
                  {["Severidad", "Acción", "Target", "Operador", "Cuándo"].map((h) => (
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
                {data.items.map((e) => {
                  const Icon = SEVERITY_ICON[e.severity];
                  return (
                    <tr key={e.id} className="hover:bg-[var(--bg-subtle,#F8FAFC)] transition-colors">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${SEVERITY_TONE[e.severity]}`}>
                          <Icon className="h-3 w-3" />
                          {e.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs bg-[var(--muted)] px-1.5 py-0.5 rounded text-[var(--color-text-dark,#0F172A)] font-mono">
                          {e.action}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-body,#475569)]">
                        {e.targetKind ? (
                          <span>
                            <span className="text-[var(--color-text-muted,#94A3B8)]">{e.targetKind}</span>
                            {e.targetId && <span className="font-mono text-xs ml-1">{e.targetId.slice(0, 12)}…</span>}
                          </span>
                        ) : (
                          <span className="text-[var(--color-text-muted,#94A3B8)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-body,#475569)]">
                        {e.superAdminEmail ?? (
                          <span className="text-[var(--color-text-muted,#94A3B8)]">sistema</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-body,#475569)] tabular-nums whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleString("es-ES", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
