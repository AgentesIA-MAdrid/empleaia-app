"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { MessageSquare, Lock, Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface Config { phoneNumberId: string | null; numeroEmpresa: string | null; activo: boolean; tokenConfigurado: boolean; updatedAt: string; }
interface MensajeW { id: string; destinatarioTelefono: string; texto: string; estado: string; createdAt: string; }

export default function WhatsappBotPage() {
  const { toast } = useToast();
  const [config, setConfig] = useState<Config | null>(null);
  const [mensajes, setMensajes] = useState<MensajeW[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [phoneId, setPhoneId] = useState("");
  const [token, setToken] = useState("");
  const [numero, setNumero] = useState("");
  const [activo, setActivo] = useState(false);
  const [tel, setTel] = useState("");
  const [texto, setTexto] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rc, rm] = await Promise.all([fetch("/api/whatsapp/config"), fetch("/api/whatsapp/mensajes")]);
      if (rc.status === 402) { setUnavailable(true); return; }
      const dc = await rc.json();
      const dm = await rm.json();
      setConfig(dc.config);
      if (dc.config) {
        setPhoneId(dc.config.phoneNumberId ?? "");
        setNumero(dc.config.numeroEmpresa ?? "");
        setActivo(dc.config.activo);
      }
      setMensajes(dm.mensajes ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveConfig = async () => {
    const body: Record<string, unknown> = {
      phoneNumberId: phoneId || null,
      numeroEmpresa: numero || null,
      activo,
    };
    if (token) body.token = token;
    const r = await fetch("/api/whatsapp/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { toast({ title: "Error", variant: "destructive" }); return; }
    toast({ title: "Configuración guardada" });
    setToken("");
    await fetchAll();
  };

  const enviar = async () => {
    if (!tel || !texto) { toast({ title: "Faltan datos", variant: "destructive" }); return; }
    const r = await fetch("/api/whatsapp/mensajes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinatarioTelefono: tel, texto }) });
    if (!r.ok) { toast({ title: "Error", variant: "destructive" }); return; }
    toast({ title: "Mensaje encolado", description: "Se enviará cuando el worker WhatsApp esté conectado" });
    setTel(""); setTexto("");
    await fetchAll();
  };

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-[var(--warning-text)] shrink-0 mt-0.5" />
            <div className="flex-1"><p className="text-sm font-semibold text-[var(--warning-text)]">Asistente WhatsApp — plan Enterprise</p></div>
            <Link href="/admin/planes"><Button size="sm">Ver planes</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center"><MessageSquare className="h-5 w-5 text-[var(--primary)]" /></div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">WhatsApp Business</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Configura las credenciales para enviar mensajes via WhatsApp Cloud API</p>
        </div>
      </div>

      <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
        <CardContent className="pt-4 pb-4 text-sm text-[var(--warning-text)]">
          <strong>MVP:</strong> los mensajes se encolan pero el envío real requiere un worker externo conectado a la API de WhatsApp Business. Configura las credenciales para tenerlas listas.
        </CardContent>
      </Card>

      {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Configuración</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label>Phone Number ID (Meta)</Label><Input className="mt-1" value={phoneId} onChange={(e) => setPhoneId(e.target.value)} placeholder="123456789012345" /></div>
              <div><Label>Número visible al cliente</Label><Input className="mt-1" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="+34 600 00 00 00" /></div>
              <div>
                <Label>Token de acceso permanente {config?.tokenConfigurado && <span className="text-xs text-[var(--success-text)] ml-2">(ya configurado, deja vacío si no quieres cambiarlo)</span>}</Label>
                <Input className="mt-1" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAxxxxx..." />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
                <span>Integración activa</span>
              </label>
              <Button onClick={saveConfig}><Save className="h-4 w-4 mr-1.5" /> Guardar</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Enviar mensaje de prueba</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label>Teléfono destinatario</Label><Input className="mt-1" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="+34 600 00 00 00" /></div>
              <div><Label>Texto</Label><textarea className="mt-1 w-full min-h-[80px] rounded-md border border-[var(--border)] px-3 py-2 text-sm" value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
              <Button onClick={enviar}><Send className="h-4 w-4 mr-1.5" /> Encolar</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Cola de mensajes ({mensajes.length})</CardTitle></CardHeader>
            <CardContent>
              {mensajes.length === 0 ? <p className="text-sm text-[var(--text-muted)]">Sin mensajes.</p> : (
                <ul className="space-y-2 text-sm">
                  {mensajes.map((m) => (
                    <li key={m.id} className="rounded-md border border-[var(--border)] p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-[var(--text-dark)]">{m.destinatarioTelefono}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${m.estado === "enviado" ? "bg-[var(--success-bg)] text-[var(--success-text)]" : m.estado === "fallido" ? "bg-[var(--danger-bg)] text-[var(--danger-text)]" : "bg-[var(--warning-bg)] text-[var(--warning-text)]"}`}>{m.estado}</span>
                      </div>
                      <p className="text-[var(--text-body)] mt-1 line-clamp-2">{m.texto}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
