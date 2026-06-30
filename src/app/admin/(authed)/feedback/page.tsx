"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Bot, Send, CheckCircle2, XCircle, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Tipo = "bug" | "mejora" | "pregunta";
type Estado = "nuevo" | "en_revision" | "en_desarrollo" | "resuelto" | "descartado";
type JobStatus = "encolado" | "ejecutando" | "pr_abierto" | "desplegado" | "sin_cambios" | "fallido";

interface AdminTicket {
  id: string;
  numero?: number;
  tipo: Tipo;
  descripcion: string;
  pagina: string;
  estado: Estado;
  org_nombre: string;
  user_email: string | null;
  user_name: string | null;
  screenshot_paths: string[] | null;
  created_at: string;
  ai_job_status: JobStatus | null;
  ultimo_autor?: "admin" | "user" | null;
}
interface Msg {
  id: string;
  autor: "admin" | "user";
  cuerpo: string;
  internal: boolean;
  is_ai: boolean;
  adjunto_path: string | null;
  created_at: string;
}
interface AiJob {
  id: string;
  status: JobStatus;
  pr_url: string | null;
  error: string | null;
  resumen_cliente: string | null;
  resumen_publicado_at: string | null;
}
interface JobEvent { id: string; phase: string; detail: string | null; created_at: string }

const TIPO_LABEL: Record<Tipo, string> = { bug: "Bug", mejora: "Mejora", pregunta: "Pregunta" };
const ESTADO_BADGE: Record<Estado, string> = {
  nuevo: "bg-amber-100 text-amber-700",
  en_revision: "bg-sky-100 text-sky-700",
  en_desarrollo: "bg-indigo-100 text-indigo-700",
  resuelto: "bg-emerald-100 text-emerald-700",
  descartado: "bg-slate-100 text-slate-500",
};
const JOB_BADGE: Record<JobStatus, string> = {
  encolado: "bg-slate-100 text-slate-600",
  ejecutando: "bg-indigo-100 text-indigo-700",
  pr_abierto: "bg-emerald-100 text-emerald-700",
  desplegado: "bg-teal-100 text-teal-700",
  sin_cambios: "bg-slate-100 text-slate-600",
  fallido: "bg-red-100 text-red-700",
};
const LIVE: JobStatus[] = ["encolado", "ejecutando"];

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function AdminFeedbackPage() {
  const { toast } = useToast();
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fEstado, setFEstado] = useState("_activos"); // por defecto, sin resueltos
  const [fJob, setFJob] = useState("");
  const [sel, setSel] = useState<AdminTicket | null>(null);

  // Carga TODOS los tickets; el filtrado es en cliente (búsqueda + columnas).
  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/feedback`);
      if (r.ok) setTickets(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Reintentar un ticket cuyo job de Claude quedó fallido: reencola un job
  // nuevo (resolve-ia hace dedupe; como el job está terminal, deja encolar).
  const reintentar = async (ticketId: string) => {
    const r = await fetch(`/api/admin/feedback/${ticketId}/resolve-ia`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) {
      toast({ variant: "destructive", title: r.status === 409 ? "Ya hay un job activo" : "No se pudo reintentar" });
      return;
    }
    toast({ variant: "success", title: "Reintentando con Claude…" });
    cargar();
  };

  const ql = q.trim().toLowerCase();
  const filtrados = tickets.filter((t) => {
    if (fTipo && t.tipo !== fTipo) return false;
    if (fEstado === "_activos") { if (t.estado === "resuelto" || t.estado === "descartado") return false; }
    else if (fEstado !== "_todos" && fEstado && t.estado !== fEstado) return false;
    if (fJob === "_sin") { if (t.ai_job_status) return false; }
    else if (fJob && t.ai_job_status !== fJob) return false;
    if (ql) {
      const num = `#${String(t.numero ?? 0).padStart(4, "0")}`;
      const hay = [num, String(t.numero ?? ""), t.org_nombre, t.user_name, t.user_email, t.descripcion]
        .some((s) => (s ?? "").toLowerCase().includes(ql));
      if (!hay) return false;
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Feedback / Soporte</h1>
        <Button variant="outline" size="sm" onClick={cargar}><RefreshCw className="mr-2 h-4 w-4" /> Recargar</Button>
      </div>

      <div className="mb-4 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar (nº, empresa, usuario, texto)…"
          className="min-w-[16rem] flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm"
        />
        <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm">
          <option value="">Todos los tipos</option>
          {(["bug", "mejora", "pregunta"] as Tipo[]).map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
        </select>
        <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm">
          <option value="_activos">Pendientes (sin resueltos ni descartados)</option>
          <option value="_todos">Todos los estados</option>
          {(["nuevo", "en_revision", "en_desarrollo", "resuelto", "descartado"] as Estado[]).map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={fJob} onChange={(e) => setFJob(e.target.value)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm">
          <option value="">Claude: todos</option>
          <option value="_sin">Sin job</option>
          {(["encolado", "ejecutando", "pr_abierto", "desplegado", "sin_cambios", "fallido"] as JobStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" /></div>
        ) : filtrados.length === 0 ? (
          <p className="py-16 text-center text-slate-400">{tickets.length === 0 ? "No hay tickets." : "Ningún ticket coincide con los filtros."}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Empresa / Usuario</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-left">Descripción</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-left">Claude</th>
                <th className="px-4 py-3 text-left">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtrados.map((t) => (
                <tr key={t.id} onClick={() => setSel(t)} className="cursor-pointer hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-400">{t.numero != null ? `#${String(t.numero).padStart(4, "0")}` : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{t.org_nombre || "—"}</div>
                    <div className="text-xs text-slate-400">{t.user_name || t.user_email || "—"}</div>
                  </td>
                  <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{TIPO_LABEL[t.tipo]}</span></td>
                  <td className="max-w-xs truncate px-4 py-3 text-slate-600">{t.descripcion}</td>
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ESTADO_BADGE[t.estado])}>{t.estado}</span>
                    {(t.estado === "nuevo" || t.estado === "en_revision") && (() => {
                      // Si Claude está atendiéndolo (o ya abrió PR / desplegó), la
                      // pelota la tiene Claude → no avisar "cliente respondió".
                      const claudeActivo = t.ai_job_status
                        ? ["encolado", "ejecutando", "pr_abierto", "desplegado"].includes(t.ai_job_status)
                        : false;
                      if (t.ultimo_autor === "user" && !claudeActivo)
                        return <span className="ml-1.5 text-xs font-semibold text-yellow-600">● cliente respondió</span>;
                      if (t.ultimo_autor === "admin")
                        return <span className="ml-1.5 text-xs font-medium text-orange-500">✓ respondido</span>;
                      if (t.ultimo_autor === null && !claudeActivo)
                        return <span className="ml-1.5 text-xs text-slate-400">sin responder</span>;
                      return null;
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      {t.ai_job_status && <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", JOB_BADGE[t.ai_job_status])}>{t.ai_job_status}</span>}
                      {t.ai_job_status === "fallido" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); reintentar(t.id); }}
                          title="Reintentar con Claude"
                          aria-label="Reintentar con Claude"
                          className="inline-flex shrink-0 items-center justify-center rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 hover:text-[var(--primary)]"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">{fmt(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sel && <DetalleTicket ticket={sel} onClose={() => { setSel(null); cargar(); }} onChanged={cargar} toast={toast} />}
    </div>
  );
}

function DetalleTicket({
  ticket,
  onClose,
  onChanged,
  toast,
}: {
  ticket: AdminTicket;
  onClose: () => void;
  onChanged: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [job, setJob] = useState<AiJob | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const eventsEndRef = useRef<HTMLLIElement>(null);
  const [resumenAdjunto, setResumenAdjunto] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [modo, setModo] = useState<"interna" | "cliente" | "claude">("cliente");
  const [busy, setBusy] = useState(false);
  const [resumenEdit, setResumenEdit] = useState("");

  const cargarHilo = useCallback(async () => {
    const r = await fetch(`/api/admin/feedback/${ticket.id}/messages`);
    if (r.ok) setMessages(await r.json());
  }, [ticket.id]);

  const cargarJob = useCallback(async () => {
    const r = await fetch(`/api/admin/feedback/${ticket.id}/ai-job`);
    if (r.ok) {
      const d = await r.json();
      setJob(d.job);
      setEvents(d.events ?? []);
      setResumenAdjunto(d.resumen_adjunto_path ?? null);
      if (d.job?.resumen_cliente && !d.job.resumen_publicado_at) setResumenEdit(d.job.resumen_cliente);
    }
  }, [ticket.id]);

  useEffect(() => {
    cargarHilo();
    cargarJob();
  }, [cargarHilo, cargarJob]);

  // Poll del job mientras esté vivo. Más frecuente para que el detalle de
  // actividad de Claude se vea casi en tiempo real.
  useEffect(() => {
    if (!job || !LIVE.includes(job.status)) return;
    const id = setInterval(() => { cargarJob(); cargarHilo(); }, 3000);
    return () => clearInterval(id);
  }, [job, cargarJob, cargarHilo]);

  // Auto-scroll de la traza de actividad al último evento.
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [events]);

  const enviar = async () => {
    // En modo Claude se puede lanzar sin texto (Claude recibe toda la
    // conversación igualmente). Para cliente/nota interna sí hace falta texto.
    if (modo !== "claude" && !composer.trim()) return;
    setBusy(true);
    try {
      if (modo === "claude") {
        const r = await fetch(`/api/admin/feedback/${ticket.id}/resolve-ia`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: composer.trim() || undefined }),
        });
        if (!r.ok) {
          toast({ variant: "destructive", title: r.status === 409 ? "Ya hay un job activo" : "No se pudo encolar" });
          return;
        }
        toast({ variant: "success", title: "Job encolado — Claude está en ello" });
        setComposer("");
        await cargarJob();
        onChanged();
      } else {
        const r = await fetch(`/api/admin/feedback/${ticket.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cuerpo: composer.trim(), internal: modo === "interna" }),
        });
        if (!r.ok) {
          toast({ variant: "destructive", title: "No se pudo enviar" });
          return;
        }
        toast({ variant: "success", title: modo === "interna" ? "Nota interna añadida" : "Respuesta enviada al cliente" });
        setComposer("");
        await cargarHilo();
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  const lanzarClaude = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/feedback/${ticket.id}/resolve-ia`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok) {
        toast({ variant: "destructive", title: r.status === 409 ? "Ya hay un job activo" : "No se pudo encolar" });
        return;
      }
      toast({ variant: "success", title: "Job encolado" });
      await cargarJob();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const publicarResumen = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/feedback/${ticket.id}/resumen/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumen: resumenEdit.trim() || undefined }),
      });
      if (!r.ok) {
        toast({ variant: "destructive", title: "No se pudo publicar" });
        return;
      }
      toast({ variant: "success", title: "Resumen publicado al cliente" });
      await Promise.all([cargarHilo(), cargarJob()]);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const cambiarEstado = async (estado: Estado) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/feedback/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      });
      if (r.ok) {
        toast({ variant: "success", title: `Marcado como ${estado}` });
        onChanged();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  // "En desarrollo": marca el ticket como proceso del equipo Y lo manda a Claude
  // con instrucción explícita de implementar (aunque sea grande), no solo
  // diagnosticar. El cliente verá "En desarrollo" en su panel; sin email.
  const marcarEnDesarrollo = async () => {
    setBusy(true);
    try {
      await fetch(`/api/admin/feedback/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "en_desarrollo" }),
      });
      const r = await fetch(`/api/admin/feedback/${ticket.id}/resolve-ia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt_override:
            "Implementa lo que pide el usuario en este ticket; revisa TODA la conversación, " +
            "incluidas sus aclaraciones. Hazlo aunque sea una mejora grande o de varias piezas: " +
            "NO te limites a diagnosticar ni te frenes por el tamaño — implementa la solución " +
            "completa y abre un PR.",
        }),
      });
      if (!r.ok && r.status !== 409) {
        toast({ variant: "destructive", title: "Marcado en desarrollo, pero no se pudo lanzar a Claude" });
      } else {
        toast({ variant: "success", title: "En desarrollo — enviado a Claude para implementar" });
      }
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const screenshots = ticket.screenshot_paths ?? [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ticket.numero != null && <span className="font-mono text-xs text-slate-400">#{String(ticket.numero).padStart(4, "0")}</span>}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{TIPO_LABEL[ticket.tipo]}</span>
            {ticket.org_nombre || "—"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Metadatos */}
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-sm">
            <p className="text-slate-700">{ticket.descripcion}</p>
            <p className="mt-1 text-xs text-slate-400">{ticket.user_name || ticket.user_email || "—"} · {ticket.pagina} · {fmt(ticket.created_at)}</p>
            {screenshots.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {screenshots.map((id) => (
                  <a key={id} href={`/api/admin/feedback/${ticket.id}/screenshot?adjunto=${id}`} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/admin/feedback/${ticket.id}/screenshot?adjunto=${id}`} alt="" className="h-16 w-16 rounded border object-cover" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Panel Claude */}
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium text-indigo-900"><Bot className="h-4 w-4" /> Resolver con Claude</span>
              {job ? (
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", JOB_BADGE[job.status])}>{job.status}</span>
              ) : (
                <Button size="sm" onClick={lanzarClaude} disabled={busy}>Lanzar</Button>
              )}
            </div>
            {events.length > 0 && (
              <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto text-xs text-indigo-700">
                {events.slice(-50).map((e) => (
                  <li key={e.id} className="flex gap-1.5">
                    <span className="shrink-0 tabular-nums text-indigo-400">
                      {new Date(e.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span className="break-all">{e.detail || e.phase}</span>
                  </li>
                ))}
                <li ref={eventsEndRef} aria-hidden className="h-0" />
              </ul>
            )}
            {job?.pr_url && (
              <a href={job.pr_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline">
                Ver PR <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {job?.error && <p className="mt-2 text-xs text-red-600">{job.error}</p>}
            {/* Resumen borrador → publicar */}
            {job?.resumen_cliente && !job.resumen_publicado_at && (
              <div className="mt-3 border-t border-indigo-100 pt-3">
                <p className="mb-1 text-xs font-medium text-indigo-900">Resumen para el cliente (borrador):</p>
                <textarea
                  className="w-full rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm"
                  rows={3}
                  value={resumenEdit}
                  onChange={(e) => setResumenEdit(e.target.value)}
                />
                {resumenAdjunto && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={`/api/admin/feedback/${ticket.id}/screenshot?adjunto=${resumenAdjunto}`} alt="" className="mt-2 max-h-32 rounded border" />
                )}
                <Button size="sm" className="mt-2" onClick={publicarResumen} disabled={busy}>Publicar al cliente</Button>
              </div>
            )}
            {job?.resumen_publicado_at && <p className="mt-2 text-xs text-emerald-600">Resumen publicado al cliente.</p>}
          </div>

          {/* Hilo */}
          <div className="space-y-2">
            {messages.map((m) => (
              <div key={m.id} className={cn("rounded-lg px-3 py-2 text-sm", m.internal ? "bg-amber-50" : m.autor === "user" ? "bg-slate-50" : "bg-[var(--primary-light)]")}>
                <span className="mb-0.5 block text-xs font-medium text-slate-400">
                  {m.is_ai ? "Claude" : m.autor === "admin" ? "Equipo" : "Usuario"}
                  {m.internal && <span className="ml-1 rounded bg-amber-200 px-1 text-[10px] text-amber-800">solo equipo</span>}
                  {!m.internal && m.autor === "admin" && <span className="ml-1 rounded bg-emerald-200 px-1 text-[10px] text-emerald-800">enviado al cliente</span>}
                  <span className="ml-1 font-normal text-slate-400">
                    {new Date(m.created_at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
                <span className="whitespace-pre-wrap text-slate-700">{m.cuerpo}</span>
              </div>
            ))}
          </div>

          {/* Compositor */}
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex gap-1 rounded-md bg-muted p-1 text-sm">
              {([["cliente", "Al cliente"], ["interna", "Nota interna"], ["claude", "A Claude"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setModo(k)} className={cn("flex-1 rounded px-2 py-1 font-medium", modo === k ? "bg-white shadow-sm" : "text-slate-500")}>{label}</button>
              ))}
            </div>
            <textarea
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              rows={3}
              placeholder={modo === "claude" ? "Instrucciones extra (opcional). Claude leerá toda la conversación automáticamente." : modo === "interna" ? "Nota visible solo para el equipo…" : "Respuesta que verá el cliente…"}
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
            />
            {modo === "claude" && (
              <p className="mt-1 text-xs text-slate-400">Claude recibe el ticket y todas las respuestas; las instrucciones son opcionales.</p>
            )}
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={enviar} disabled={busy || (modo !== "claude" && !composer.trim())}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                {modo === "claude" ? (composer.trim() ? "Enviar a Claude con instrucciones" : "Enviar todo a Claude") : "Enviar"}
              </Button>
            </div>
          </div>

          {/* Acciones de estado */}
          <div className="flex gap-2 border-t border-slate-100 pt-3">
            {ticket.estado !== "resuelto" && ticket.estado !== "descartado" && ticket.estado !== "en_desarrollo" && (
              <Button
                size="sm"
                variant="outline"
                className="border-indigo-200 text-indigo-600"
                onClick={marcarEnDesarrollo}
                disabled={busy}
                title="Marca el ticket como proceso del equipo y lo manda a Claude para que lo implemente"
              >
                <Bot className="mr-1.5 h-4 w-4" /> En desarrollo → Claude
              </Button>
            )}
            <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => cambiarEstado("resuelto")} disabled={busy}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Resuelto
            </Button>
            <Button size="sm" variant="outline" className="text-slate-500" onClick={() => cambiarEstado("descartado")} disabled={busy}>
              <XCircle className="mr-1.5 h-4 w-4" /> Descartar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
