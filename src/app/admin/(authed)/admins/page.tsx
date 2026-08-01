"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  ShieldCheck,
  UserPlus,
  Mail,
  X,
  Ban,
  Clock,
} from "lucide-react";

type Role = "SUPER_ADMIN" | "SUPPORT";

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  lastLogin: string | null;
  createdAt: string;
}

interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

interface ApiResponse {
  admins: AdminRow[];
  invitations: InvitationRow[];
  me: string;
  myRole: Role;
}

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Administrador completo",
  SUPPORT: "Soporte",
};

const ROLE_DESC: Record<Role, string> = {
  SUPER_ADMIN:
    "Acceso total: invitar y gestionar administradores, y gestionar tenants (suspender, extender/cancelar suscripción, borrar).",
  SUPPORT:
    "Solo lectura: puede ver tenants, tickets, métricas y el registro de actividad, pero no puede modificar nada.",
};

const ROLE_TONE: Record<Role, string> = {
  SUPER_ADMIN: "bg-indigo-50 text-indigo-800",
  SUPPORT: "bg-[var(--muted)] text-[var(--text-body)]",
};

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AdminsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    let stopped = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch("/api/admin/admins");
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
  }, [reloadTick]);

  const refresh = useCallback(() => setReloadTick((n) => n + 1), []);

  const changeRole = useCallback(
    async (row: AdminRow, nextRole: Role) => {
      if (nextRole === row.role) return;
      const verbo =
        nextRole === "SUPER_ADMIN"
          ? `dar acceso completo a ${row.name}`
          : `pasar a ${row.name} a solo lectura (Soporte)`;
      if (!window.confirm(`¿Confirmas ${verbo} (${row.email})?`)) return;
      setPendingId(row.id);
      setActionError(null);
      setActionInfo(null);
      try {
        const r = await fetch(`/api/admin/admins/${row.id}/role`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: nextRole }),
        });
        const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r.ok) {
          const code = payload.error as string | undefined;
          const msg =
            code === "ultimo_super_admin"
              ? "No puedes dejar el panel sin ningún administrador completo activo."
              : code === "no_puedes_cambiar_tu_propio_rol"
                ? "No puedes cambiar tu propio rol."
                : (code ?? `HTTP ${r.status}`);
          throw new Error(msg);
        }
        setActionInfo(`Rol de ${row.email} actualizado a ${ROLE_LABEL[nextRole]}`);
        refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Error de red");
      } finally {
        setPendingId(null);
      }
    },
    [refresh],
  );

  const deactivate = useCallback(
    async (row: AdminRow) => {
      if (
        !window.confirm(
          `¿Desactivar a ${row.name} (${row.email})? Dejará de poder acceder al panel. Es reversible reinvitándolo.`,
        )
      ) {
        return;
      }
      setPendingId(row.id);
      setActionError(null);
      setActionInfo(null);
      try {
        const r = await fetch(`/api/admin/admins/${row.id}/deactivate`, {
          method: "POST",
        });
        const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r.ok) {
          throw new Error(
            (payload.error as string | undefined) ?? `HTTP ${r.status}`,
          );
        }
        setActionInfo(`${row.email} desactivado`);
        refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Error de red");
      } finally {
        setPendingId(null);
      }
    },
    [refresh],
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            Administradores
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            Cuentas con acceso al panel super-admin de empleaIA
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Invitar administrador
        </button>
      </header>

      {/* Leyenda: qué puede hacer cada rol */}
      <div className="grid gap-3 sm:grid-cols-2">
        {(["SUPER_ADMIN", "SUPPORT"] as Role[]).map((r) => (
          <div key={r} className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-3">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_TONE[r]}`}>
              {ROLE_LABEL[r]}
            </span>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-body,#475569)]">{ROLE_DESC[r]}</p>
          </div>
        ))}
      </div>

      {(actionError || actionInfo) && (
        <div
          className={`flex items-start gap-2 px-4 py-3 rounded-lg text-sm border ${
            actionError
              ? "bg-[var(--danger-bg)] border-[var(--danger-bg)] text-[var(--danger-text)]"
              : "bg-[var(--success-bg)] border-[var(--success-bg)] text-[var(--success-text)]"
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

      {/* Super-admins */}
      <div className="bg-[var(--card)] border border-[var(--color-border,#E2E8F0)] rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--color-text-body,#475569)]">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Cargando administradores…
          </div>
        ) : error ? (
          <div className="px-4 py-3 text-sm text-[var(--danger-text)] bg-[var(--danger-bg)] border-b border-[var(--danger-bg)]">
            {error}
          </div>
        ) : !data || data.admins.length === 0 ? (
          <div className="py-16 text-center text-[var(--color-text-muted,#94A3B8)]">
            <ShieldCheck className="h-10 w-10 mx-auto mb-2 text-slate-200" />
            <p className="text-sm">No hay administradores</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--bg-subtle,#F8FAFC)] border-b border-[var(--color-border,#E2E8F0)]">
                <tr>
                  {["Email", "Nombre", "Rol", "Estado", "Último acceso", "Acciones"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-body,#475569)] px-4 py-3"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.admins.map((a) => (
                  <tr
                    key={a.id}
                    className="hover:bg-[var(--bg-subtle,#F8FAFC)] transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-[var(--color-text-dark,#0F172A)] font-medium">
                      {a.email}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-body,#475569)]">
                      {a.name}
                    </td>
                    <td className="px-4 py-3">
                      {data.myRole === "SUPER_ADMIN" && a.id !== data.me && a.active ? (
                        <select
                          value={a.role}
                          disabled={pendingId === a.id}
                          onChange={(e) => void changeRole(a, e.target.value as Role)}
                          className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-2 py-1 text-xs focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 disabled:opacity-50"
                          title="Cambiar rol"
                        >
                          <option value="SUPER_ADMIN">Administrador completo</option>
                          <option value="SUPPORT">Soporte (solo lectura)</option>
                        </select>
                      ) : (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_TONE[a.role]}`}
                        >
                          {ROLE_LABEL[a.role]}
                          {a.id === data.me && <span className="ml-1 opacity-60">· tú</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {a.active ? (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-[var(--success-bg)] text-[var(--success-text)]">
                          Activo
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-[var(--muted)] text-[var(--text-body)]">
                          Inactivo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-body,#475569)] tabular-nums">
                      {fmtDate(a.lastLogin)}
                    </td>
                    <td className="px-4 py-3">
                      {a.active ? (
                        <button
                          type="button"
                          disabled={pendingId === a.id}
                          onClick={() => void deactivate(a)}
                          className="inline-flex items-center gap-1 text-xs text-[var(--danger-text)] hover:text-[var(--danger-text)] disabled:opacity-50"
                          title="Desactivar administrador"
                        >
                          {pendingId === a.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Ban className="h-3 w-3" />
                          )}
                          Desactivar
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted,#94A3B8)]">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invitaciones pendientes */}
      {data && data.invitations.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--color-text-dark,#0F172A)] flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-[var(--color-text-muted,#94A3B8)]" />
            Invitaciones pendientes
          </h2>
          <div className="bg-[var(--card)] border border-[var(--color-border,#E2E8F0)] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--bg-subtle,#F8FAFC)] border-b border-[var(--color-border,#E2E8F0)]">
                  <tr>
                    {["Email", "Rol", "Caduca"].map((h) => (
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
                  {data.invitations.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-dark,#0F172A)] inline-flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-[var(--color-text-muted,#94A3B8)]" />
                        {inv.email}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_TONE[inv.role]}`}
                        >
                          {ROLE_LABEL[inv.role]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-body,#475569)] tabular-nums">
                        {fmtDate(inv.expiresAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onInvited={(email) => {
            setInviteOpen(false);
            setActionError(null);
            setActionInfo(`Invitación enviada a ${email}`);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function InviteModal({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("SUPPORT");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/admins/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), role }),
      });
      const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        const code = payload.error as string | undefined;
        const msg =
          code === "ya_existe_admin_activo"
            ? "Ya existe un administrador activo con ese email."
            : code === "email_invalido"
              ? "El email no es válido."
              : code === "role_invalido"
                ? "Rol no válido."
                : (code ?? `HTTP ${r.status}`);
        throw new Error(msg);
      }
      onInvited(email.trim().toLowerCase());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-title"
    >
      <form
        onSubmit={submit}
        className="bg-[var(--card)] rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
            <UserPlus className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div className="flex-1">
            <h2 id="invite-title" className="text-lg font-semibold text-[var(--text-dark)]">
              Invitar administrador
            </h2>
            <p className="text-sm text-[var(--text-body)] mt-1">
              Recibirá un email con un enlace para crear su cuenta. Caduca en 7 días.
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor="invite-email"
            className="block text-sm font-medium text-[var(--text-dark)] mb-1.5"
          >
            Correo electrónico
          </label>
          <input
            id="invite-email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nuevo.admin@empleaia.es"
            className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
          />
        </div>

        <div>
          <label
            htmlFor="invite-role"
            className="block text-sm font-medium text-[var(--text-dark)] mb-1.5"
          >
            Rol
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
          >
            <option value="SUPPORT">Soporte (solo lectura)</option>
            <option value="SUPER_ADMIN">Administrador completo</option>
          </select>
        </div>

        {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-body)] hover:bg-[var(--muted)] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Enviar invitación
          </button>
        </div>
      </form>
    </div>
  );
}
