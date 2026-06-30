"use client";

import { useCallback, useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  CalendarPlus,
  XCircle,
  AlertTriangle,
} from "lucide-react";

type TenantStatus =
  | "pending"
  | "provisioning"
  | "active"
  | "suspended"
  | "deleted";

type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "paused"
  | "incomplete"
  | "incomplete_expired";

interface TenantFeature {
  featureKey: string;
  value: unknown;
  source: string;
  expiresAt: string | null;
  reason?: string | null;
}

interface Subscription {
  id: string;
  status: SubscriptionStatus;
  planKey: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
}

interface QuotaUsage {
  featureKey: string;
  consumed: number;
  max: number | null;
  periodEnd: string;
}

interface TenantDetail {
  id: string;
  slug: string;
  name: string;
  email: string;
  status: TenantStatus;
  stripeCustomerId: string | null;
  customDomain: string | null;
  customDomainVerified: boolean;
  createdAt: string;
  tenantFeatures: TenantFeature[];
  subscriptions: Subscription[];
  quotaUsage: QuotaUsage[];
}

const STATUS_TONE: Record<TenantStatus, string> = {
  active: "bg-emerald-50 text-emerald-800",
  pending: "bg-slate-100 text-slate-600",
  provisioning: "bg-sky-50 text-sky-800",
  suspended: "bg-orange-50 text-orange-800",
  deleted: "bg-red-50 text-red-800",
};

const STATUS_LABEL: Record<TenantStatus, string> = {
  active: "Activo",
  pending: "Pendiente",
  provisioning: "Aprovisionando",
  suspended: "Suspendido",
  deleted: "Eliminado",
};

const SUB_STATUS_TONE: Record<SubscriptionStatus, string> = {
  trialing: "bg-sky-50 text-sky-800",
  active: "bg-emerald-50 text-emerald-800",
  past_due: "bg-amber-50 text-amber-800",
  unpaid: "bg-orange-50 text-orange-800",
  canceled: "bg-red-50 text-red-800",
  paused: "bg-slate-100 text-slate-600",
  incomplete: "bg-amber-50 text-amber-800",
  incomplete_expired: "bg-red-50 text-red-800",
};

const SUB_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trialing: "En periodo de prueba",
  active: "Activa",
  past_due: "Pago vencido",
  unpaid: "Impagada",
  canceled: "Cancelada",
  paused: "Pausada",
  incomplete: "Incompleta",
  incomplete_expired: "Incompleta (expirada)",
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

type ModalKind = "extend" | "cancel" | null;

export default function TenantDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalKind>(null);
  const [extendDias, setExtendDias] = useState<string>("30");
  const [extendMotivo, setExtendMotivo] = useState("");
  const [cancelMotivo, setCancelMotivo] = useState("");

  const refresh = useCallback(() => setReloadTick((n) => n + 1), []);

  useEffect(() => {
    let stopped = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/admin/tenants/${slug}`);
        if (r.status === 401) {
          window.location.href = "/admin/login";
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const payload = (await r.json()) as { tenant: TenantDetail };
        if (!stopped) setTenant(payload.tenant);
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : "Error de red");
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [slug, reloadTick]);

  const rootDomain =
    typeof window !== "undefined"
      ? window.location.host.replace(/^admin\./, "")
      : "empleaia.es";

  const postAction = useCallback(
    async (
      path: string,
      successMessage: string,
      body?: unknown,
    ): Promise<boolean> => {
      setPending(true);
      setActionError(null);
      setActionInfo(null);
      try {
        const r = await fetch(`/api/admin/tenants/${slug}${path}`, {
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
            (payload.error as string | undefined) ?? `HTTP ${r.status}`;
          throw new Error(reason);
        }
        setActionInfo(successMessage);
        refresh();
        return true;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Error de red");
        return false;
      } finally {
        setPending(false);
      }
    },
    [slug, refresh],
  );

  const sub = tenant?.subscriptions?.[0] ?? null;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/tenants"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-body,#475569)] hover:text-[var(--color-text-dark,#0F172A)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a tenants
      </Link>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-[var(--color-text-body,#475569)]">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Cargando tenant…
        </div>
      ) : error ? (
        <div className="px-4 py-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      ) : !tenant ? (
        <div className="px-4 py-3 text-sm text-[var(--color-text-muted,#94A3B8)]">
          Tenant no encontrado.
        </div>
      ) : (
        <>
          {/* Cabecera */}
          <header className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
                  {tenant.name}
                </h1>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[tenant.status]}`}
                >
                  {STATUS_LABEL[tenant.status]}
                </span>
              </div>
              <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-[var(--color-text-dark,#0F172A)] font-mono mt-1 inline-block">
                {tenant.slug}
              </code>
            </div>
            <a
              href={`https://${tenant.slug}.${rootDomain}/admin`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-[var(--color-border,#E2E8F0)] text-[var(--primary)] hover:bg-[var(--bg-subtle,#F8FAFC)]"
            >
              <ExternalLink className="h-4 w-4" />
              Abrir panel del cliente
            </a>
          </header>

          {(actionError || actionInfo) && (
            <div
              className={`px-4 py-3 rounded-lg text-sm border ${
                actionError
                  ? "bg-red-50 border-red-200 text-red-800"
                  : "bg-emerald-50 border-emerald-200 text-emerald-800"
              }`}
              role="status"
            >
              {actionError ?? actionInfo}
            </div>
          )}

          {/* Datos */}
          <section className="bg-white border border-[var(--color-border,#E2E8F0)] rounded-lg p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-body,#475569)] mb-4">
              Datos
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-[var(--color-text-muted,#94A3B8)] text-xs uppercase tracking-wide">
                  Email
                </dt>
                <dd className="text-[var(--color-text-dark,#0F172A)] mt-0.5">
                  {tenant.email}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted,#94A3B8)] text-xs uppercase tracking-wide">
                  Dominio
                </dt>
                <dd className="text-[var(--color-text-dark,#0F172A)] mt-0.5">
                  {tenant.customDomain ? (
                    <span className="inline-flex items-center gap-1.5">
                      {tenant.customDomain}
                      {tenant.customDomainVerified ? (
                        <span className="text-emerald-700 text-xs">
                          (verificado)
                        </span>
                      ) : (
                        <span className="text-amber-700 text-xs">
                          (pendiente)
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[var(--color-text-muted,#94A3B8)]">
                      Sin dominio propio
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted,#94A3B8)] text-xs uppercase tracking-wide">
                  Fecha de alta
                </dt>
                <dd className="text-[var(--color-text-dark,#0F172A)] mt-0.5">
                  {fmtDate(tenant.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted,#94A3B8)] text-xs uppercase tracking-wide">
                  Stripe Customer
                </dt>
                <dd className="text-[var(--color-text-dark,#0F172A)] mt-0.5">
                  {tenant.stripeCustomerId ? (
                    <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                      {tenant.stripeCustomerId}
                    </code>
                  ) : (
                    <span className="text-[var(--color-text-muted,#94A3B8)]">
                      Sin Stripe (alta manual)
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          {/* Suscripción */}
          <section className="bg-white border border-[var(--color-border,#E2E8F0)] rounded-lg p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-body,#475569)] mb-4">
              Suscripción
            </h2>
            {sub ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-[var(--color-text-muted,#94A3B8)] text-xs uppercase tracking-wide">
                    Plan
                  </dt>
                  <dd className="text-[var(--color-text-dark,#0F172A)] mt-0.5">
                    {sub.planKey}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-muted,#94A3B8)] text-xs uppercase tracking-wide">
                    Estado
                  </dt>
                  <dd className="mt-0.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${SUB_STATUS_TONE[sub.status]}`}
                    >
                      {SUB_STATUS_LABEL[sub.status]}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-muted,#94A3B8)] text-xs uppercase tracking-wide">
                    Inicio de periodo
                  </dt>
                  <dd className="text-[var(--color-text-dark,#0F172A)] mt-0.5">
                    {fmtDate(sub.currentPeriodStart)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-muted,#94A3B8)] text-xs uppercase tracking-wide">
                    Fin de periodo
                  </dt>
                  <dd className="text-[var(--color-text-dark,#0F172A)] mt-0.5">
                    {fmtDate(sub.currentPeriodEnd)}
                  </dd>
                </div>
                {sub.trialEnd && (
                  <div>
                    <dt className="text-[var(--color-text-muted,#94A3B8)] text-xs uppercase tracking-wide">
                      Fin de prueba
                    </dt>
                    <dd className="text-[var(--color-text-dark,#0F172A)] mt-0.5">
                      {fmtDate(sub.trialEnd)}
                    </dd>
                  </div>
                )}
                {sub.cancelAtPeriodEnd && (
                  <div className="sm:col-span-2">
                    <span className="inline-flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Se cancela al final del periodo
                    </span>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-sm text-[var(--color-text-muted,#94A3B8)]">
                Sin suscripción registrada (alta manual sin Stripe).
              </p>
            )}
          </section>

          {/* Features */}
          <section className="bg-white border border-[var(--color-border,#E2E8F0)] rounded-lg p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-body,#475569)] mb-4">
              Features
            </h2>
            {tenant.tenantFeatures.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted,#94A3B8)]">
                Sin overrides de features.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-[var(--color-border,#E2E8F0)]">
                    <tr>
                      {["Feature", "Valor", "Origen", "Expira"].map((h) => (
                        <th
                          key={h}
                          className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-body,#475569)] py-2 pr-4"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tenant.tenantFeatures.map((f) => (
                      <tr key={`${f.featureKey}-${f.source}`}>
                        <td className="py-2 pr-4">
                          <code className="text-xs font-mono text-[var(--color-text-dark,#0F172A)]">
                            {f.featureKey}
                          </code>
                        </td>
                        <td className="py-2 pr-4 text-[var(--color-text-dark,#0F172A)]">
                          {typeof f.value === "object"
                            ? JSON.stringify(f.value)
                            : String(f.value)}
                        </td>
                        <td className="py-2 pr-4 text-[var(--color-text-body,#475569)]">
                          {f.source}
                        </td>
                        <td className="py-2 pr-4 text-[var(--color-text-body,#475569)] tabular-nums">
                          {fmtDate(f.expiresAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Cuota */}
          <section className="bg-white border border-[var(--color-border,#E2E8F0)] rounded-lg p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-body,#475569)] mb-4">
              Cuota (periodo en curso)
            </h2>
            {tenant.quotaUsage.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted,#94A3B8)]">
                Sin consumo de cuota registrado.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-[var(--color-border,#E2E8F0)]">
                    <tr>
                      {["Feature", "Consumido / Máx", "Fin de periodo"].map(
                        (h) => (
                          <th
                            key={h}
                            className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-body,#475569)] py-2 pr-4"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tenant.quotaUsage.map((qu) => (
                      <tr key={qu.featureKey}>
                        <td className="py-2 pr-4">
                          <code className="text-xs font-mono text-[var(--color-text-dark,#0F172A)]">
                            {qu.featureKey}
                          </code>
                        </td>
                        <td className="py-2 pr-4 text-[var(--color-text-dark,#0F172A)] tabular-nums">
                          {qu.consumed} / {qu.max === null ? "∞" : qu.max}
                        </td>
                        <td className="py-2 pr-4 text-[var(--color-text-body,#475569)] tabular-nums">
                          {fmtDate(qu.periodEnd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Acciones */}
          <section className="bg-white border border-[var(--color-border,#E2E8F0)] rounded-lg p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-body,#475569)] mb-4">
              Acciones
            </h2>
            <div className="flex flex-wrap gap-3">
              {tenant.status === "active" && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `¿Suspender el acceso del tenant "${tenant.slug}"? Es reversible.`,
                      )
                    ) {
                      void postAction(
                        "/suspend",
                        `Tenant ${tenant.slug} suspendido`,
                      );
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-amber-200 text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                >
                  <Pause className="h-4 w-4" />
                  Suspender acceso
                </button>
              )}
              {tenant.status === "suspended" && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    void postAction(
                      "/restore",
                      `Tenant ${tenant.slug} restaurado`,
                    );
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-emerald-200 text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  Restaurar acceso
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setExtendDias("30");
                  setExtendMotivo("");
                  setActionError(null);
                  setModal("extend");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-[var(--color-border,#E2E8F0)] text-[var(--color-text-dark,#0F172A)] hover:bg-[var(--bg-subtle,#F8FAFC)] disabled:opacity-50"
              >
                <CalendarPlus className="h-4 w-4" />
                Extender periodo
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setCancelMotivo("");
                  setActionError(null);
                  setModal("cancel");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-800 hover:bg-red-50 disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" />
                Cancelar suscripción
              </button>
            </div>
          </section>
        </>
      )}

      {/* Modal extender */}
      {modal === "extend" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="extend-title"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <h2
              id="extend-title"
              className="text-lg font-semibold text-slate-900"
            >
              Extender periodo de suscripción
            </h2>
            <p className="text-sm text-slate-600">
              Suma días al fin de periodo de la suscripción.{" "}
              <strong>Solo afecta a la BD local, no a Stripe.</strong>
            </p>
            <div>
              <label
                htmlFor="extend-dias"
                className="block text-sm font-medium text-slate-900 mb-1"
              >
                Días (1–365)
              </label>
              <input
                id="extend-dias"
                type="number"
                min={1}
                max={365}
                value={extendDias}
                onChange={(e) => setExtendDias(e.target.value)}
                className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20"
              />
            </div>
            <div>
              <label
                htmlFor="extend-motivo"
                className="block text-sm font-medium text-slate-900 mb-1"
              >
                Motivo (mínimo 10 caracteres)
              </label>
              <textarea
                id="extend-motivo"
                rows={3}
                value={extendMotivo}
                onChange={(e) => setExtendMotivo(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20"
              />
            </div>
            {actionError && (
              <p className="text-sm text-red-700">{actionError}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={pending}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={async () => {
                  const dias = Number(extendDias);
                  const ok = await postAction(
                    "/subscription/extend",
                    `Periodo extendido ${dias} día(s)`,
                    { dias, motivo: extendMotivo },
                  );
                  if (ok) setModal(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Extender
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal cancelar */}
      {modal === "cancel" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-title"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-700" />
              </div>
              <div className="flex-1">
                <h2
                  id="cancel-title"
                  className="text-lg font-semibold text-slate-900"
                >
                  Cancelar suscripción
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  Marca la suscripción como cancelada en la BD local.
                </p>
              </div>
            </div>
            <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
              Esto <strong>NO</strong> cancela el cobro en Stripe; cancela
              también en Stripe si aplica.
            </div>
            <div>
              <label
                htmlFor="cancel-motivo"
                className="block text-sm font-medium text-slate-900 mb-1"
              >
                Motivo (mínimo 10 caracteres)
              </label>
              <textarea
                id="cancel-motivo"
                rows={3}
                value={cancelMotivo}
                onChange={(e) => setCancelMotivo(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20"
              />
            </div>
            {actionError && (
              <p className="text-sm text-red-700">{actionError}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={pending}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cerrar
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={async () => {
                  const ok = await postAction(
                    "/subscription/cancel",
                    "Suscripción cancelada (BD local)",
                    { motivo: cancelMotivo },
                  );
                  if (ok) setModal(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Cancelar suscripción
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
