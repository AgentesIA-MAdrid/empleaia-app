"use client";

import { useEffect, useState, useCallback } from "react";
import { Bell, Mail, Smartphone, Save, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface Prefs {
  inAppAusencias: boolean;
  inAppTurnos: boolean;
  inAppTareas: boolean;
  inAppFichajes: boolean;
  inAppComunicados: boolean;
  emailAusencias: boolean;
  emailTurnos: boolean;
  emailTareas: boolean;
  emailFichajes: boolean;
  emailComunicados: boolean;
  pushAusencias: boolean;
  pushTurnos: boolean;
  pushTareas: boolean;
  pushFichajes: boolean;
  pushComunicados: boolean;
}

interface GlobalConfig {
  pushActivo: boolean;
  publicKey: string | null;
  emailActivo?: boolean;
}

const EVENTOS = [
  { key: "Ausencias", label: "Ausencias", desc: "Solicitudes y cambios de estado" },
  { key: "Turnos", label: "Turnos", desc: "Publicación y modificación de turnos" },
  { key: "Tareas", label: "Tareas", desc: "Asignación y cambios en tareas" },
  { key: "Fichajes", label: "Fichajes", desc: "Confirmaciones de fichaje" },
  { key: "Comunicados", label: "Comunicados", desc: "Nuevos comunicados de la empresa" },
] as const;

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function PreferenciasPage() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig>({ pushActivo: false, publicKey: null });
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    const [prefsRes, vapidRes] = await Promise.all([
      fetch("/api/notificaciones/preferencias"),
      fetch("/api/push/vapid-public-key"),
    ]);
    if (prefsRes.ok) setPrefs(await prefsRes.json());
    if (vapidRes.ok) {
      const v = await vapidRes.json();
      setGlobalConfig(v);
    }

    // Check current push subscription
    if ("serviceWorker" in navigator && "PushManager" in window) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setPushSubscribed(!!sub);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const res = await fetch("/api/notificaciones/preferencias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Preferencias guardadas" });
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePush = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast({ title: "Tu navegador no soporta notificaciones push", variant: "destructive" });
      return;
    }
    setPushLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (pushSubscribed) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch("/api/push/subscripcion", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          await sub.unsubscribe();
        }
        setPushSubscribed(false);
        toast({ title: "Notificaciones push desactivadas" });
      } else {
        if (!globalConfig.publicKey) {
          toast({ title: "Push no configurado por el administrador", variant: "destructive" });
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast({ title: "Permiso de notificaciones denegado", variant: "destructive" });
          return;
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(globalConfig.publicKey),
        });
        await fetch("/api/push/subscripcion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        setPushSubscribed(true);
        toast({ title: "Notificaciones push activadas" });
      }
    } catch (e) {
      console.error(e);
      toast({ title: "Error al configurar push", variant: "destructive" });
    } finally {
      setPushLoading(false);
    }
  };

  const toggle = (field: keyof Prefs) =>
    setPrefs((p) => p && { ...p, [field]: !p[field] });

  const Toggle = ({ value, onChange }: { value: boolean; onChange: () => void }) => (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${value ? "bg-[var(--primary)]" : "bg-slate-200"}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${value ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );

  if (!prefs) return <div className="p-6 animate-pulse"><div className="h-40 bg-slate-100 rounded-xl" /></div>;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Preferencias de notificaciones</h1>
        <p className="text-slate-500 text-sm mt-1">Elige cómo y cuándo quieres recibir notificaciones</p>
      </div>

      {/* Push suscripción */}
      {globalConfig.pushActivo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-[var(--primary)]" /> Notificaciones push
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-700">
                  {pushSubscribed ? "Activadas en este dispositivo" : "Desactivadas en este dispositivo"}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {pushSubscribed
                    ? "Recibirás notificaciones aunque el navegador esté cerrado"
                    : "Actívalas para recibir alertas en tiempo real"}
                </p>
              </div>
              <Button
                variant={pushSubscribed ? "outline" : "default"}
                size="sm"
                onClick={handleTogglePush}
                disabled={pushLoading}
              >
                {pushLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : pushSubscribed ? (
                  "Desactivar"
                ) : (
                  "Activar"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabla de preferencias por evento */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-[var(--primary)]" /> Qué notificaciones recibir
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 sm:gap-4 px-4 sm:px-6 py-2 border-b bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wide">
            <span>Evento</span>
            <span className="flex items-center gap-1 w-14 justify-center"><Bell className="h-3 w-3" />App</span>
            <span className="flex items-center gap-1 w-14 justify-center"><Mail className="h-3 w-3" />Email</span>
            <span className="flex items-center gap-1 w-14 justify-center"><Smartphone className="h-3 w-3" />Push</span>
          </div>
          <div className="divide-y">
            {EVENTOS.map(({ key, label, desc }) => {
              const inAppKey = `inApp${key}` as keyof Prefs;
              const emailKey = `email${key}` as keyof Prefs;
              const pushKey = `push${key}` as keyof Prefs;
              return (
                <div key={key} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 sm:gap-4 px-4 sm:px-6 py-3 items-center hover:bg-slate-50">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{label}</p>
                    <p className="text-xs text-slate-400">{desc}</p>
                  </div>
                  <div className="w-14 flex justify-center">
                    <Toggle value={prefs[inAppKey]} onChange={() => toggle(inAppKey)} />
                  </div>
                  <div className="w-14 flex justify-center">
                    <Toggle value={prefs[emailKey]} onChange={() => toggle(emailKey)} />
                  </div>
                  <div className="w-14 flex justify-center">
                    {globalConfig.pushActivo ? (
                      <Toggle value={prefs[pushKey]} onChange={() => toggle(pushKey)} />
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Guardando..." : "Guardar preferencias"}
        </Button>
      </div>
    </div>
  );
}
