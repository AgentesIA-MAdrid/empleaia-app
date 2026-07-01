"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Send, UserPlus, X, Ban, CheckCircle2, Copy, Link2 } from "lucide-react";

interface Recipient {
  id: string;
  label: string;
  chatId: string | null;
  active: boolean;
  canOperate: boolean;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  linkedAt: string | null;
  createdAt: string;
}
interface WebhookInfo {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
}
interface ApiResponse {
  recipients: Recipient[];
  webhook: WebhookInfo | null;
  botUsername: string | null;
  configured: boolean;
}

export default function TelegramPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let stop = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch("/api/admin/telegram");
        if (r.status === 401) { window.location.href = "/admin/login"; return; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (!stop) setData((await r.json()) as ApiResponse);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : "Error de red");
      } finally {
        if (!stop) setLoading(false);
      }
    })();
    return () => { stop = true; };
  }, [tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const patch = useCallback(async (row: Recipient, body: Record<string, boolean>) => {
    setPendingId(row.id); setError(null); setInfo(null);
    try {
      const r = await fetch(`/api/admin/telegram/${row.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setPendingId(null); }
  }, [refresh]);

  const remove = useCallback(async (row: Recipient) => {
    if (!window.confirm(`¿Eliminar a ${row.label}? Dejará de recibir y operar.`)) return;
    setPendingId(row.id); setError(null); setInfo(null);
    try {
      const r = await fetch(`/api/admin/telegram/${row.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setInfo(`${row.label} eliminado`); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setPendingId(null); }
  }, [refresh]);

  const connect = useCallback(async () => {
    setConnecting(true); setError(null); setInfo(null);
    try {
      const r = await fetch("/api/admin/telegram/connect", { method: "POST" });
      const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) throw new Error((payload.detail as string) || (payload.error as string) || `HTTP ${r.status}`);
      setInfo("Bot conectado: webhook registrado en Telegram."); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setConnecting(false); }
  }, [refresh]);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">Bot de Telegram</h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            Gestiona los tickets desde Telegram: responder al cliente, enviar a Claudia, en desarrollo, resolver…
          </p>
        </div>
        <button type="button" onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] px-4 py-2 text-sm font-semibold text-white shadow-sm">
          <UserPlus className="h-4 w-4" /> Añadir persona
        </button>
      </header>

      {(error || info) && (
        <div className={`flex items-start gap-2 px-4 py-3 rounded-lg text-sm border ${error ? "bg-red-50 border-red-200 text-red-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`} role="status">
          <span className="flex-1">{error ?? info}</span>
          <button type="button" onClick={() => { setError(null); setInfo(null); }} className="opacity-60 hover:opacity-100"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Estado del bot / webhook */}
      <div className="bg-white border border-[var(--color-border,#E2E8F0)] rounded-lg p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm">
            <p className="font-medium text-[var(--color-text-dark,#0F172A)] flex items-center gap-1.5"><Send className="h-4 w-4 text-[var(--primary)]" /> Estado del bot</p>
            {data && !data.configured && (
              <p className="mt-1 text-amber-700">Faltan las variables <code>TELEGRAM_BOT_TOKEN</code> / <code>TELEGRAM_WEBHOOK_SECRET</code> en el servidor.</p>
            )}
            {data?.configured && (
              <p className="mt-1 text-[var(--color-text-body,#475569)]">
                {data.botUsername ? <>Bot: <a className="text-[var(--primary)] underline" href={`https://t.me/${data.botUsername}`} target="_blank" rel="noreferrer">@{data.botUsername}</a>. </> : null}
                {data.webhook?.url ? <>Webhook activo{typeof data.webhook.pending_update_count === "number" ? ` · ${data.webhook.pending_update_count} pendientes` : ""}.</> : "Webhook sin registrar."}
                {data.webhook?.last_error_message ? <span className="text-red-600"> Último error: {data.webhook.last_error_message}</span> : null}
              </p>
            )}
          </div>
          <button type="button" onClick={connect} disabled={connecting || !data?.configured}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border,#E2E8F0)] px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Conectar bot
          </button>
        </div>
      </div>

      {/* Destinatarios */}
      <div className="bg-white border border-[var(--color-border,#E2E8F0)] rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--color-text-body,#475569)]"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…</div>
        ) : !data || data.recipients.length === 0 ? (
          <div className="py-16 text-center text-[var(--color-text-muted,#94A3B8)]"><Send className="h-10 w-10 mx-auto mb-2 text-slate-200" /><p className="text-sm">Aún no hay nadie dado de alta</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--bg-subtle,#F8FAFC)] border-b border-[var(--color-border,#E2E8F0)]">
                <tr>{["Persona", "Estado", "Permiso", "Acciones"].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-body,#475569)] px-4 py-3">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recipients.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--bg-subtle,#F8FAFC)]">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">{r.label}</div>
                      {r.chatId
                        ? <div className="text-xs text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Vinculado</div>
                        : <PairingHint code={r.pairingCode} expires={r.pairingExpiresAt} bot={data.botUsername} />}
                    </td>
                    <td className="px-4 py-3">
                      {r.active
                        ? <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-800">Activo</span>
                        : <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-slate-100 text-slate-600">Inactivo</span>}
                    </td>
                    <td className="px-4 py-3">
                      <select value={r.canOperate ? "op" : "rx"} disabled={pendingId === r.id}
                        onChange={(e) => void patch(r, { canOperate: e.target.value === "op" })}
                        className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-2 py-1 text-xs disabled:opacity-50">
                        <option value="op">Puede operar</option>
                        <option value="rx">Solo recibe</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button type="button" disabled={pendingId === r.id} onClick={() => void patch(r, { active: !r.active })}
                          className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 disabled:opacity-50">
                          {pendingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                          {r.active ? "Desactivar" : "Activar"}
                        </button>
                        <button type="button" disabled={pendingId === r.id} onClick={() => void remove(r)}
                          className="inline-flex items-center gap-1 text-xs text-red-700 hover:text-red-900 disabled:opacity-50">
                          <X className="h-3 w-3" /> Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addOpen && (
        <AddModal
          onClose={() => setAddOpen(false)}
          onAdded={(label) => { setAddOpen(false); setInfo(`${label} añadido. Pásale el código de vinculación.`); refresh(); }}
        />
      )}
    </div>
  );
}

function PairingHint({ code, expires, bot }: { code: string | null; expires: string | null; bot: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!code) return <div className="text-xs text-slate-400">Pendiente de vincular</div>;
  const caducado = expires ? new Date(expires).getTime() < Date.now() : false;
  return (
    <div className="text-xs text-[var(--color-text-body,#475569)] mt-0.5">
      Código: <code className="rounded bg-slate-100 px-1 font-mono">{code}</code>
      <button type="button" onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); }} className="ml-1 text-slate-400 hover:text-[var(--primary)]" title="Copiar">
        <Copy className="inline h-3 w-3" />
      </button>
      {copied && <span className="ml-1 text-emerald-600">copiado</span>}
      {caducado
        ? <span className="ml-1 text-amber-600">(caducado — elimina y vuelve a añadir)</span>
        : <span className="ml-1 text-slate-400">{bot ? <>· que lo envíe a <a className="underline" href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">@{bot}</a></> : "· que lo envíe al bot"}</span>}
    </div>
  );
}

function AddModal({ onClose, onAdded }: { onClose: () => void; onAdded: (label: string) => void }) {
  const [label, setLabel] = useState("");
  const [canOperate, setCanOperate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true); setErr(null);
    try {
      const r = await fetch("/api/admin/telegram", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim(), canOperate }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onAdded(label.trim());
    } catch (e) { setErr(e instanceof Error ? e.message : "Error de red"); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--primary)]/10 flex items-center justify-center"><UserPlus className="h-5 w-5 text-[var(--primary)]" /></div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-slate-900">Añadir persona</h2>
            <p className="text-sm text-slate-600 mt-1">Se genera un código de un solo uso (15 min). La persona lo envía al bot para vincularse.</p>
          </div>
        </div>
        <div>
          <label htmlFor="tg-label" className="block text-sm font-medium text-slate-900 mb-1.5">Nombre</label>
          <input id="tg-label" required autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Dani, Borja…"
            className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={canOperate} onChange={(e) => setCanOperate(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-[var(--primary)]" />
          Puede operar (responder, enviar a Claudia, resolver…). Desmárcalo si solo debe recibir avisos.
        </label>
        {err && <p className="text-sm text-red-700">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={submitting || !label.trim()} className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] disabled:opacity-50 inline-flex items-center gap-1.5">
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Generar código
          </button>
        </div>
      </form>
    </div>
  );
}
