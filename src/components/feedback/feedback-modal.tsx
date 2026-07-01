"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, X, ImagePlus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";

type Tipo = "bug" | "mejora" | "pregunta";
const TIPO_OPTIONS: { value: Tipo; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "mejora", label: "Mejora" },
  { value: "pregunta", label: "Pregunta" },
];

interface TicketSummary {
  id: string;
  numero?: number;
  tipo: Tipo;
  descripcion: string;
  estado: string;
  visto_por_user: boolean;
  ultimo_autor?: "admin" | "user" | null;
  created_at: string;
}
interface TicketMessage {
  id: string;
  autor: "admin" | "user";
  cuerpo: string;
  is_ai?: boolean;
  adjunto_path?: string | null;
  created_at: string;
}

// Estado como texto de color (sin pill), estilo maqueta.
const ESTADO_TEXT: Record<string, string> = {
  nuevo: "text-slate-700",
  en_revision: "text-blue-600",
  en_desarrollo: "text-indigo-600",
  resuelto: "text-emerald-600",
  descartado: "text-slate-400",
};
const ESTADO_LABEL: Record<string, string> = {
  nuevo: "Nuevo",
  en_revision: "En revisión",
  en_desarrollo: "En desarrollo",
  resuelto: "Resuelto",
  descartado: "Descartado",
};
const TIPO_LABEL: Record<Tipo, string> = {
  bug: "BUG",
  mejora: "MEJORA",
  pregunta: "PREGUNTA",
};
// Etiqueta de estado que ve el usuario. Si el equipo ya respondió y el ticket
// sigue abierto (nuevo/en revisión), muestra "Respondido" para distinguirlo de
// los que están pendientes de respuesta.
function estadoVista(t: { estado: string; ultimo_autor?: "admin" | "user" | null }): { label: string; cls: string } {
  if (t.estado === "resuelto" || t.estado === "descartado") {
    return { label: ESTADO_LABEL[t.estado] ?? t.estado, cls: ESTADO_TEXT[t.estado] ?? "text-slate-700" };
  }
  // En desarrollo: estado propio que siempre se muestra (el equipo lo está
  // implementando), tenga o no respuesta del equipo en el hilo.
  if (t.estado === "en_desarrollo") {
    return { label: "En desarrollo", cls: "text-indigo-600" };
  }
  // El equipo escribió lo último → el usuario tiene respuesta que leer.
  if (t.ultimo_autor === "admin") {
    return { label: "Respondido", cls: "text-orange-500" };
  }
  return { label: ESTADO_LABEL[t.estado] ?? t.estado, cls: ESTADO_TEXT[t.estado] ?? "text-slate-700" };
}
const fmtFecha = (iso: string) => new Date(iso).toLocaleDateString("es-ES");
const MAX_FILES = 5;

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]";

export function FeedbackModal({
  open,
  onClose,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"enviar" | "mis">("enviar");
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [loading, setLoading] = useState(false);
  const [screenshots, setScreenshots] = useState<{ file: File; preview: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [reply, setReply] = useState("");
  const [replyImage, setReplyImage] = useState<{ file: File; preview: string } | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const replyFileRef = useRef<HTMLInputElement>(null);

  const loadTickets = useCallback(async () => {
    setLoadingTickets(true);
    try {
      const res = await fetch("/api/feedback/my-tickets");
      if (res.ok) setTickets(await res.json());
    } finally {
      setLoadingTickets(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch("/api/feedback/mark-seen", { method: "POST" }).catch(() => {});
    if (tab === "mis") loadTickets();
  }, [open, tab, loadTickets]);

  const addFiles = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) {
      if (files.length > 0) toast({ variant: "destructive", title: "Solo se aceptan imágenes" });
      return;
    }
    setScreenshots((prev) => {
      const room = MAX_FILES - prev.length;
      if (room <= 0) {
        toast({ variant: "destructive", title: `Máximo ${MAX_FILES} imágenes` });
        return prev;
      }
      return [...prev, ...images.slice(0, room).map((file) => ({ file, preview: URL.createObjectURL(file) }))];
    });
  };

  // Pegar capturas desde el portapapeles (Cmd/Ctrl+V) en el textarea.
  const onPasteImages = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return; // texto normal: no interferir
    e.preventDefault();
    addFiles(files);
  };

  const clearForm = () => {
    screenshots.forEach((s) => URL.revokeObjectURL(s.preview));
    setScreenshots([]);
    setTipo(null);
    setDescripcion("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!tipo || !descripcion.trim()) {
      toast({ variant: "destructive", title: "Elige el tipo y escribe una descripción" });
      return;
    }
    setLoading(true);
    try {
      let screenshot_paths: string[] | undefined;
      if (screenshots.length > 0) {
        try {
          screenshot_paths = await Promise.all(
            screenshots.map(async ({ file }) => {
              const fd = new FormData();
              fd.append("file", file);
              const r = await fetch("/api/feedback/upload", { method: "POST", body: fd });
              if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Error al subir imagen");
              return ((await r.json()) as { path: string }).path;
            }),
          );
        } catch (e) {
          toast({ variant: "destructive", title: e instanceof Error ? e.message : "Error al subir imágenes" });
          return;
        }
      }
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          descripcion: descripcion.trim(),
          pagina: window.location.pathname,
          ...(screenshot_paths ? { screenshot_paths } : {}),
        }),
      });
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: res.status === 429 ? "Límite de feedback por hoy alcanzado" : "Error al enviar",
        });
        return;
      }
      toast({ variant: "success", title: "¡Gracias! Lo revisamos pronto" });
      clearForm();
      onSent?.();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const clearReplyImage = () => {
    setReplyImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview);
      return null;
    });
    if (replyFileRef.current) replyFileRef.current.value = "";
  };

  const addReplyImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ variant: "destructive", title: "Solo se aceptan imágenes" });
      return;
    }
    setReplyImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview);
      return { file, preview: URL.createObjectURL(file) };
    });
  };

  const toggleThread = async (ticketId: string) => {
    if (expandedId === ticketId) return setExpandedId(null);
    setExpandedId(ticketId);
    setMessages([]);
    setReply("");
    clearReplyImage();
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/feedback/my-tickets/${ticketId}/messages`);
      if (res.ok) setMessages(await res.json());
    } finally {
      setLoadingMessages(false);
    }
  };

  const sendReply = async (ticketId: string) => {
    if (!reply.trim() && !replyImage) return;
    setSendingReply(true);
    try {
      let adjunto_path: string | undefined;
      if (replyImage) {
        try {
          const fd = new FormData();
          fd.append("file", replyImage.file);
          const r = await fetch("/api/feedback/upload", { method: "POST", body: fd });
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Error al subir imagen");
          adjunto_path = ((await r.json()) as { path: string }).path;
        } catch (e) {
          toast({ variant: "destructive", title: e instanceof Error ? e.message : "Error al subir imagen" });
          return;
        }
      }
      const res = await fetch(`/api/feedback/my-tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuerpo: reply.trim(), ...(adjunto_path ? { adjunto_path } : {}) }),
      });
      if (!res.ok) {
        toast({ variant: "destructive", title: "No se pudo enviar" });
        return;
      }
      const nuevo = await res.json();
      setMessages((prev) => [...prev, nuevo]);
      setReply("");
      clearReplyImage();
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="grid-cols-1 w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Feedback</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(["enviar", "mis"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t ? "bg-white text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {t === "enviar" ? "Enviar" : "Mis tickets"}
            </button>
          ))}
        </div>

        {tab === "enviar" ? (
          <div className="space-y-3 py-1">
            <div className="flex gap-2">
              {TIPO_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTipo(opt.value)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    tipo === opt.value
                      ? "border-[var(--primary)] bg-[var(--primary-light)] text-[var(--primary)]"
                      : "border-slate-200 text-slate-600 hover:border-[var(--primary)]",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <textarea
              className={cn(inputCls, "min-h-[110px] resize-y")}
              placeholder="¿Qué ocurre? Cuéntanoslo con detalle. Puedes pegar una captura con Cmd/Ctrl+V."
              maxLength={2000}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              onPaste={onPasteImages}
            />
            {/* Capturas */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); if (fileInputRef.current) fileInputRef.current.value = ""; }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"
              >
                <ImagePlus className="h-4 w-4" /> Adjuntar capturas ({screenshots.length}/{MAX_FILES})
              </button>
              {screenshots.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {screenshots.map((s, i) => (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.preview} alt="" className="h-14 w-14 rounded-md object-cover border" />
                      <button
                        onClick={() => setScreenshots((p) => p.filter((_, j) => j !== i))}
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-slate-700 p-0.5 text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Button className="w-full" onClick={handleSubmit} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar
            </Button>
          </div>
        ) : (
          <div className="space-y-2 py-1">
            {loadingTickets ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-[var(--primary)]" /></div>
            ) : tickets.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Aún no has enviado ningún ticket.</p>
            ) : (
              tickets.map((t) => (
                <div key={t.id} className="rounded-lg border border-slate-100">
                  <button
                    onClick={() => toggleThread(t.id)}
                    className="w-full px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold tracking-wide text-slate-500">{TIPO_LABEL[t.tipo]}</span>
                      {(() => {
                        const v = estadoVista(t);
                        return <span className={cn("shrink-0 text-xs font-semibold", v.cls)}>{v.label}</span>;
                      })()}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">{t.descripcion}</p>
                    <p className="mt-1.5 text-xs text-slate-400">
                      {t.numero != null && <span className="mr-1.5">#{String(t.numero).padStart(4, "0")}</span>}
                      {fmtFecha(t.created_at)}
                    </p>
                  </button>
                  {expandedId === t.id && (
                    <div className="border-t border-slate-100 p-3">
                      {loadingMessages ? (
                        <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-[var(--primary)]" /></div>
                      ) : (
                        <div className="space-y-2">
                          {messages.length === 0 && <p className="text-xs text-slate-400">Sin respuestas todavía.</p>}
                          {messages.map((m) => (
                            <div
                              key={m.id}
                              className={cn(
                                "rounded-lg px-3 py-2 text-sm break-words",
                                m.autor === "user" ? "bg-[var(--primary-light)] text-slate-700" : "bg-slate-50 text-slate-700",
                              )}
                            >
                              <span className="mb-0.5 block text-xs font-medium text-slate-400">
                                {m.autor === "user" ? "Tú" : "Soporte"}
                              </span>
                              {m.cuerpo && <Markdown className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{m.cuerpo}</Markdown>}
                              {m.adjunto_path && (
                                <a
                                  href={`/api/feedback/my-tickets/${t.id}/screenshot?adjunto=${m.adjunto_path}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={cn("block", m.cuerpo && "mt-1.5")}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={`/api/feedback/my-tickets/${t.id}/screenshot?adjunto=${m.adjunto_path}`}
                                    alt="Adjunto"
                                    className="max-h-44 max-w-full rounded-md border object-contain"
                                  />
                                </a>
                              )}
                            </div>
                          ))}
                          <div className="space-y-2 pt-1">
                            <textarea
                              className={cn(inputCls, "min-h-[80px] resize-y")}
                              placeholder="Responder…"
                              maxLength={5000}
                              value={reply}
                              onChange={(e) => setReply(e.target.value)}
                              onPaste={(e) => {
                                const img = Array.from(e.clipboardData?.items ?? [])
                                  .find((it) => it.kind === "file" && it.type.startsWith("image/"))?.getAsFile();
                                if (img) { e.preventDefault(); addReplyImage(img); }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                  e.preventDefault();
                                  sendReply(t.id);
                                }
                              }}
                            />
                            {replyImage && (
                              <div className="relative inline-block">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={replyImage.preview} alt="" className="h-16 w-16 rounded-md border object-cover" />
                                <button
                                  onClick={clearReplyImage}
                                  className="absolute -right-1.5 -top-1.5 rounded-full bg-slate-700 p-0.5 text-white"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-2">
                              <input
                                ref={replyFileRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => { addReplyImage(e.target.files?.[0]); if (replyFileRef.current) replyFileRef.current.value = ""; }}
                              />
                              <button
                                type="button"
                                onClick={() => replyFileRef.current?.click()}
                                className="inline-flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline"
                              >
                                <ImagePlus className="h-4 w-4" /> Adjuntar imagen
                              </button>
                              <Button
                                size="sm"
                                className="shrink-0"
                                onClick={() => sendReply(t.id)}
                                disabled={sendingReply || (!reply.trim() && !replyImage)}
                              >
                                {sendingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                                Enviar
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
