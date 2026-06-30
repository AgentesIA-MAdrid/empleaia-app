"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Loader2,
  ExternalLink,
  Globe,
  Pause,
  Play,
  Trash2,
  X,
  AlertTriangle,
} from "lucide-react";

interface Tenant {
  id: string;
  slug: string;
  name: string;
  email: string;
  status: "pending" | "provisioning" | "active" | "suspended" | "deleted";
  customDomain?: string | null;
  customDomainVerified?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApiResponse {
  items: Tenant[];
  total: number;
}

const STATUS_FILTERS = [
  { value: "", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "trialing", label: "Trial" },
  { value: "pending", label: "Pendientes" },
  { value: "provisioning", label: "Aprovisionando" },
  { value: "suspended", label: "Suspendidos" },
  { value: "deleted", label: "Eliminados" },
] as const;

const STATUS_TONE: Record<Tenant["status"], string> = {
  active: "bg-emerald-50 text-emerald-800",
  pending: "bg-amber-50 text-amber-800",
  provisioning: "bg-sky-50 text-sky-800",
  suspended: "bg-orange-50 text-orange-800",
  deleted: "bg-slate-100 text-slate-600",
};

const STATUS_LABEL: Record<Tenant["status"], string> = {
  active: "Activo",
  pending: "Pendiente",
  provisioning: "Aprovisionando",
  suspended: "Suspendido",
  deleted: "Eliminado",
};

type PurgeMode = "pseudonymize" | "hard-delete";

interface PurgeState {
  tenant: Tenant;
  mode: PurgeMode;
  confirmText: string;
  submitting: boolean;
  error: string | null;
}

export default function TenantsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [purge, setPurge] = useState<PurgeState | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (status) p.set("status", status);
    p.set("limit", "100");
    return p.toString();
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(() => {
      let stopped = false;
      (async () => {
        setLoading(true);
        setError(null);
        try {
          const r = await fetch(`/api/admin/tenants?${queryString}`);
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
    }, 200);
    return () => clearTimeout(t);
  }, [queryString, reloadTick]);

  const refresh = useCallback(() => setReloadTick((n) => n + 1), []);

  const runAction = useCallback(
    async (
      tenant: Tenant,
      path: string,
      successMessage: string,
      body?: unknown,
    ) => {
      setPendingId(tenant.id);
      setActionError(null);
      setActionInfo(null);
      try {
        const r = await fetch(`/api/admin/tenants/${tenant.slug}${path}`, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const payload = (await r.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!r.ok) {
          const reason =
            (payload.reason as string | undefined) ??
            (payload.error as string | undefined) ??
            `HTTP ${r.status}`;
          throw new Error(reason);
        }
        const note = payload.note as string | undefined;
        setActionInfo(note ? `${successMessage} — ${note}` : successMessage);
        refresh();
        return true;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Error de red");
        return false;
      } finally {
        setPendingId(null);
      }
    },
    [refresh],
  );

  const rootDomain = typeof window !== "undefined"
    ? window.location.host.replace(/^admin\./, "")
    : "empleaia.es";

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            Tenants
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            {data ? `${data.total} cuenta${data.total === 1 ? "" : "s"} en total` : "Cargando…"}
          </p>
        </div>
      </header>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted,#94A3B8)]" />
          <input
            type="search"
            placeholder="Buscar por slug, nombre o email…"
            className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white pl-9 pr-3 py-2 text-sm placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatus(f.value)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                status === f.value
                  ? "bg-white text-[var(--color-text-dark,#0F172A)] shadow-sm"
                  : "text-[var(--color-text-body,#475569)] hover:text-[var(--color-text-dark,#0F172A)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {(actionError || actionInfo) && (
        <div
          className={`flex items-start gap-2 px-4 py-3 rounded-lg text-sm border ${
            actionError
              ? "bg-red-50 border-red-200 text-red-800"
              : "bg-emerald-50 border-emerald-200 text-emerald-800"
          }`}
          role="status"
        >
          <span className="flex-1">{actionError ?? actionInfo}</span>
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setActionInfo(null);
            }}
            className="opacity-60 hover:opacity-100"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white border border-[var(--color-border,#E2E8F0)] rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--color-text-body,#475569)]">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Cargando tenants…
          </div>
        ) : error ? (
          <div className="px-4 py-3 text-sm text-red-800 bg-red-50 border-b border-red-200">{error}</div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-16 text-center text-[var(--color-text-muted,#94A3B8)]">
            <Globe className="h-10 w-10 mx-auto mb-2 text-slate-200" />
            <p className="text-sm">No hay tenants que coincidan</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--bg-subtle,#F8FAFC)] border-b border-[var(--color-border,#E2E8F0)]">
                <tr>
                  {["Slug", "Empresa", "Email", "Estado", "Dominio", "Creado", "Acciones"].map((h) => (
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
                {data.items.map((t) => (
                  <tr key={t.id} className="hover:bg-[var(--bg-subtle,#F8FAFC)] transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/tenants/${t.slug}`}
                        className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-[var(--primary)] font-mono hover:underline"
                      >
                        {t.slug}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-[var(--color-text-dark,#0F172A)]">
                      {t.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-body,#475569)] max-w-[220px] truncate">
                      {t.email}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[t.status]}`}>
                        {STATUS_LABEL[t.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {t.customDomain ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[var(--color-text-body,#475569)]">{t.customDomain}</span>
                          {t.customDomainVerified ? (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" title="Verificado" />
                          ) : (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" title="Pendiente verificación" />
                          )}
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-muted,#94A3B8)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-body,#475569)] tabular-nums">
                      {new Date(t.createdAt).toLocaleDateString("es-ES")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/admin/tenants/${t.slug}`}
                          className="inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
                        >
                          Ver
                        </Link>
                        <a
                          href={`https://${t.slug}.${rootDomain}/admin`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Abrir
                        </a>
                        {t.status === "active" && (
                          <button
                            type="button"
                            disabled={pendingId === t.id}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `¿Suspender el tenant "${t.slug}"? Pasará a estado suspendido y dejará de poder acceder. Es reversible.`,
                                )
                              ) {
                                void runAction(t, "/suspend", `Tenant ${t.slug} suspendido`);
                              }
                            }}
                            className="inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 disabled:opacity-50"
                            title="Suspender tenant"
                          >
                            {pendingId === t.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Pause className="h-3 w-3" />
                            )}
                            Suspender
                          </button>
                        )}
                        {t.status === "suspended" && (
                          <button
                            type="button"
                            disabled={pendingId === t.id}
                            onClick={() => {
                              void runAction(t, "/restore", `Tenant ${t.slug} restaurado`);
                            }}
                            className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 disabled:opacity-50"
                            title="Restaurar tenant"
                          >
                            {pendingId === t.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            Restaurar
                          </button>
                        )}
                        {t.status === "deleted" && (
                          <button
                            type="button"
                            onClick={() =>
                              setPurge({
                                tenant: t,
                                mode: "pseudonymize",
                                confirmText: "",
                                submitting: false,
                                error: null,
                              })
                            }
                            className="inline-flex items-center gap-1 text-xs text-red-700 hover:text-red-900"
                            title="Purgar tenant"
                          >
                            <Trash2 className="h-3 w-3" />
                            Purgar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {purge && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="purge-title"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-700" />
              </div>
              <div className="flex-1">
                <h2
                  id="purge-title"
                  className="text-lg font-semibold text-slate-900"
                >
                  Purgar tenant {purge.tenant.slug}
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  Esta operación es <strong>irreversible</strong>. Solo se permite
                  sobre tenants en estado <code>deleted</code>. La acción queda
                  auditada; la ejecución física la realiza el CLI en el servidor.
                </p>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-900">Modo</legend>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="purge-mode"
                  value="pseudonymize"
                  checked={purge.mode === "pseudonymize"}
                  onChange={() =>
                    setPurge((p) => p && { ...p, mode: "pseudonymize" })
                  }
                  className="mt-0.5"
                />
                <span>
                  <strong>Pseudonimizar</strong>
                  <span className="block text-xs text-slate-600">
                    Borra PII (email, nombre). Conserva fichajes para RD 8/2019.
                    Tras 4 años se podrá hacer hard-delete.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="purge-mode"
                  value="hard-delete"
                  checked={purge.mode === "hard-delete"}
                  onChange={() =>
                    setPurge((p) => p && { ...p, mode: "hard-delete" })
                  }
                  className="mt-0.5"
                />
                <span>
                  <strong>Hard delete</strong>
                  <span className="block text-xs text-slate-600">
                    DROP SCHEMA + DELETE filas master. El slug queda libre. Solo
                    permitido si el tenant lleva más de 4 años en{" "}
                    <code>deleted</code>.
                  </span>
                </span>
              </label>
            </fieldset>

            <div>
              <label className="block text-sm font-medium text-slate-900 mb-1">
                Escribe el slug{" "}
                <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">
                  {purge.tenant.slug}
                </code>{" "}
                para confirmar
              </label>
              <input
                type="text"
                value={purge.confirmText}
                onChange={(e) =>
                  setPurge((p) => p && { ...p, confirmText: e.target.value })
                }
                className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20"
                placeholder={purge.tenant.slug}
                autoFocus
              />
            </div>

            {purge.error && (
              <p className="text-sm text-red-700">{purge.error}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPurge(null)}
                disabled={purge.submitting}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  purge.submitting || purge.confirmText !== purge.tenant.slug
                }
                onClick={async () => {
                  if (!purge) return;
                  setPurge((p) => p && { ...p, submitting: true, error: null });
                  const ok = await runAction(
                    purge.tenant,
                    "/purge",
                    `Purga de ${purge.tenant.slug} (${purge.mode}) registrada`,
                    { mode: purge.mode, confirmSlug: purge.confirmText },
                  );
                  if (ok) {
                    setPurge(null);
                  } else {
                    setPurge((p) =>
                      p && { ...p, submitting: false, error: "Falló la purga. Revisa el detalle arriba." },
                    );
                  }
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {purge.submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Purgar tenant
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
