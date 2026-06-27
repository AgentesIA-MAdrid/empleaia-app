"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, X, ImagePlus, Send, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Tipo = "bug" | "mejora" | "pregunta";
const TIPO_OPTIONS: { value: Tipo; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "mejora", label: "Mejora" },
  { value: "pregunta", label: "Pregunta" },
];

interface TicketSummary {
  id: string;
  tipo: Tipo;
  descripcion: string;
  estado: string;
  visto_por_user: boolean;
  created_at: string;
}
interface TicketMessage {
  id: string;
  autor: "admin" | "user";
  cuerpo: string;
  is_ai?: boolean;
  created_at: string;
}

const ESTADO_BADGE: Record<string, string> = {
  nuevo: "bg-slate-100 text-slate-600",
  en_revision: "bg-amber-100 text-amber-700",
  resuelto: "bg-emerald-100 text-emerald-700",
  descartado: "bg-slate-100 text-slate-400",
};
const ESTADO_LABEL: Record<string, string> = {
  nuevo: "Nuevo",
  en_revision: "En revisión",
  resuelto: "Resuelto",
  descartado: "Descartado",
};
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
  const [sendingReply, setSendingReply] = useState(false);

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

  const toggleThread = async (ticketId: string) => {
    if (expandedId === ticketId) return setExpandedId(null);
    setExpandedId(ticketId);
    setMessages([]);
    setReply("");
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/feedback/my-tickets/${ticketId}/messages`);
      if (res.ok) setMessages(await res.json());
    } finally {
      setLoadingMessages(false);
    }
  };

  const sendReply = async (ticketId: string) => {
    if (!reply.trim()) return;
    setSendingReply(true);
    try {
      const res = await fetch(`/api/feedback/my-tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuerpo: reply.trim() }),
      });
      if (!res.ok) {
        toast({ variant: "destructive", title: "No se pudo enviar" });
        return;
      }
      setMessages((prev) => [...prev, await res.json()]);
      setReply("");
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
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
              placeholder="¿Qué ocurre? Cuéntanoslo con detalle."
              maxLength={2000}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
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
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-700">{t.descripcion}</span>
                    </span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", ESTADO_BADGE[t.estado])}>
                      {ESTADO_LABEL[t.estado] ?? t.estado}
                    </span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", expandedId === t.id && "rotate-180")} />
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
                                "rounded-lg px-3 py-2 text-sm",
                                m.autor === "user" ? "bg-[var(--primary-light)] text-slate-700" : "bg-slate-50 text-slate-700",
                              )}
                            >
                              <span className="mb-0.5 block text-xs font-medium text-slate-400">
                                {m.autor === "user" ? "Tú" : "Soporte"}
                              </span>
                              {m.cuerpo}
                            </div>
                          ))}
                          <div className="flex gap-2 pt-1">
                            <input
                              className={inputCls}
                              placeholder="Responder…"
                              value={reply}
                              onChange={(e) => setReply(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") sendReply(t.id); }}
                            />
                            <Button size="icon" onClick={() => sendReply(t.id)} disabled={sendingReply}>
                              <Send className="h-4 w-4" />
                            </Button>
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
