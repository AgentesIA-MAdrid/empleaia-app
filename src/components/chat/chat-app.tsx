"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { MessageCircle, Send, Loader2, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";

interface Persona { id: string; nombre: string; apellidos: string; foto?: string | null; }
interface Mensaje { id: string; texto: string; createdAt: string; autor: Persona; }
interface ParticipanteFull { id: string; userId: string; user: Persona; }
interface UltMensaje { id: string; texto: string; autor: Persona; createdAt: string; }
interface Conversacion {
  id: string; nombre: string | null; tipo: "directo" | "grupo";
  participantes: ParticipanteFull[];
  mensajes: UltMensaje[];
  noLeidos: number;
  updatedAt: string;
}

export function ChatApp() {
  const [convs, setConvs] = useState<Conversacion[]>([]);
  const [empleados, setEmpleados] = useState<Persona[]>([]);
  const [meId, setMeId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [open, setOpen] = useState(false);
  const [otherId, setOtherId] = useState("");
  const lastSince = useRef<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const fetchConvs = useCallback(async () => {
    const r = await fetch("/api/chat/conversaciones");
    if (r.status === 402) { setUnavailable(true); return; }
    const d = await r.json();
    setConvs(d.conversaciones ?? []);
  }, []);

  const fetchEmpleados = useCallback(async () => {
    // /api/chat/contactos es accesible por cualquier rol (no solo admin),
    // a diferencia de /api/empleados.
    const r = await fetch("/api/chat/contactos");
    if (!r.ok) return;
    const d = await r.json();
    setEmpleados((d.empleados ?? d ?? []).map((e: Record<string, unknown>) => ({
      id: String(e.id), nombre: String(e.nombre ?? ""), apellidos: String(e.apellidos ?? ""),
    })));
  }, []);

  const fetchMe = useCallback(async () => {
    const r = await fetch("/api/me");
    if (r.ok) {
      const d = await r.json();
      setMeId(d.user?.id ?? d.id ?? "");
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchConvs(), fetchEmpleados(), fetchMe()]);
      setLoading(false);
    })();
  }, [fetchConvs, fetchEmpleados, fetchMe]);

  useEffect(() => {
    if (!activeId) { setMensajes([]); lastSince.current = null; return; }
    (async () => {
      const r = await fetch(`/api/chat/conversaciones/${activeId}/mensajes`);
      const d = await r.json();
      setMensajes(d.mensajes ?? []);
      lastSince.current = d.mensajes?.length > 0 ? d.mensajes[d.mensajes.length - 1].createdAt : new Date().toISOString();
      setTimeout(() => scrollerRef.current?.scrollTo({ top: 9e9 }), 50);
    })();
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    const since = lastSince.current ? `?since=${encodeURIComponent(lastSince.current)}` : "";
    const es = new EventSource(`/api/chat/conversaciones/${activeId}/stream${since}`);
    es.addEventListener("message", (e) => {
      try {
        const m: Mensaje = JSON.parse((e as MessageEvent).data);
        setMensajes((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        lastSince.current = m.createdAt;
        setTimeout(() => scrollerRef.current?.scrollTo({ top: 9e9, behavior: "smooth" }), 50);
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      // El navegador reintenta automáticamente; si la sesión expiró
      // el cierre limpio lo hace este effect al desmontar.
    };
    return () => es.close();
  }, [activeId]);

  const handleSend = async () => {
    if (!activeId || !texto.trim()) return;
    const t = texto.trim();
    setTexto("");
    const r = await fetch(`/api/chat/conversaciones/${activeId}/mensajes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto: t }),
    });
    if (r.ok) {
      const d = await r.json();
      setMensajes((prev) => [...prev, d.mensaje]);
      lastSince.current = d.mensaje.createdAt;
      setTimeout(() => scrollerRef.current?.scrollTo({ top: 9e9, behavior: "smooth" }), 50);
    }
  };

  const handleNewConv = async () => {
    if (!otherId) return;
    const r = await fetch("/api/chat/conversaciones", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantesIds: [otherId] }),
    });
    if (r.ok) {
      const d = await r.json();
      setOpen(false); setOtherId("");
      await fetchConvs();
      setActiveId(d.conversacion.id);
    }
  };

  const labelConv = (c: Conversacion): string => {
    if (c.nombre) return c.nombre;
    const otros = c.participantes.filter((p) => p.userId !== meId);
    return otros.map((p) => `${p.user.nombre} ${p.user.apellidos}`).join(", ") || "Chat";
  };

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1"><p className="text-sm font-semibold text-amber-900">Chat — plan Pro o superior</p></div>
            <Link href="/admin/planes"><Button size="sm">Ver planes</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 h-[calc(100vh-100px)] flex gap-4">
      <div className="w-72 flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="p-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2"><MessageCircle className="h-4 w-4" /> Chats</h2>
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="p-4"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div> :
            convs.length === 0 ? <p className="p-4 text-sm text-slate-500">Sin chats. Crea uno.</p> :
            convs.map((c) => (
              <button key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 ${activeId === c.id ? "bg-slate-50" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-900 truncate">{labelConv(c)}</p>
                  {c.noLeidos > 0 && <span className="text-xs bg-[var(--primary)] text-white rounded-full px-1.5 py-0.5">{c.noLeidos}</span>}
                </div>
                {c.mensajes[0] && <p className="text-xs text-slate-500 truncate mt-0.5">{c.mensajes[0].texto}</p>}
              </button>
            ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden">
        {!activeId ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Selecciona un chat</div>
        ) : (
          <>
            <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {mensajes.map((m) => {
                const mio = m.autor.id === meId;
                return (
                  <div key={m.id} className={`flex gap-2 ${mio ? "justify-end" : "justify-start"}`}>
                    {!mio && <EmployeeAvatar nombre={m.autor.nombre} apellidos={m.autor.apellidos} seed={m.autor.id} size="sm" />}
                    <div className={`max-w-[70%] rounded-lg px-3 py-2 ${mio ? "bg-[var(--primary)] text-white" : "bg-slate-100 text-slate-900"}`}>
                      <p className="text-sm whitespace-pre-wrap break-words">{m.texto}</p>
                      <p className={`text-[10px] mt-0.5 ${mio ? "text-white/70" : "text-slate-500"}`}>{new Date(m.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-3 border-t border-slate-200 flex gap-2">
              <Input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSend()} placeholder="Escribe un mensaje..." />
              <Button onClick={handleSend} disabled={!texto.trim()}><Send className="h-4 w-4" /></Button>
            </div>
          </>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo chat</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600">Selecciona un compañero para iniciar conversación.</p>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {empleados.filter((e) => e.id !== meId).map((e) => (
                <label key={e.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer">
                  <input type="radio" name="other" checked={otherId === e.id} onChange={() => setOtherId(e.id)} />
                  <span className="text-sm">{e.nombre} {e.apellidos}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleNewConv} disabled={!otherId}>Iniciar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
