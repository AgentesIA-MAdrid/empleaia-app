"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Save, Plus, Trash2, Settings, Calendar, AlertTriangle, Bell,
  Mail, Smartphone, RefreshCw, Eye, EyeOff, Check, X, Palette, Upload, Image,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { signOut } from "next-auth/react";
import { PlanUsageCard } from "@/components/plan-usage-card";
import { FeatureGateClient } from "@/components/feature-gate-client";
import { UpsellCTA } from "@/components/upsell-cta";
import { CalendarioTab } from "@/components/configuracion/calendario-tab";
import { DominioTab } from "@/components/configuracion/dominio-tab";
import { ChecklistFichajeTab } from "@/components/configuracion/checklist-fichaje-tab";
import { CatalogoVentasTab } from "@/components/configuracion/catalogo-ventas-tab";
import { useFeatures } from "@/lib/hooks/use-features";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Configuracion {
  id: string;
  nombre: string;
  horasJornadaDiaria: number;
  horasSemanales: number;
  toleranciaFichaje: number;
  geofencingActivo: boolean;
  geoObligatoria: boolean;
  faceIdObligatorio: boolean;
  faceIdGuardarFoto: boolean;
  retencionFotosDias: number;
  fichajeMovilActivo: boolean;
  fichajeTabletActivo: boolean;
  // Notificaciones globales
  notifAusencias: boolean;
  notifTurnos: boolean;
  notifTareas: boolean;
  notifFichajes: boolean;
  notifComunicados: boolean;
  notifDocumentos: boolean;
  notifFueraSede: boolean;
  // Email
  emailActivo: boolean;
  emailHost: string;
  emailPort: number;
  emailSecure: boolean;
  emailUser: string;
  emailPassword: string;
  emailFrom: string;
  // Push
  pushActivo: boolean;
  pushVapidPublicKey: string | null;
  // Branding
  appNombre: string;
  logo: string | null;
  favicon: string | null;
  colorPrimario: string;
  colorSidebar: string;
  // Fase 6 §3: configuración general por tenant.
  zonaHoraria: string;
  diasLaborables: number[];
  // Reglas de cálculo de prenómina (Enterprise-ready).
  nominaJornadaSemanal?: number;
  nominaHoraExtraFactor?: number;
  nominaPlusNocturnidadActivo?: boolean;
  nominaNocturnidadDesde?: string;
  nominaNocturnidadHasta?: string;
  nominaPlusNocturnidadFactor?: number;
  nominaPlusFestivoActivo?: boolean;
  nominaPlusFestivoFactor?: number;
  nominaSalarioBaseDefault?: number;
  nominaMoneda?: string;
}

interface TipoAusencia {
  id: string;
  nombre: string;
  color: string;
  pagada: boolean;
  requiereAprobacion: boolean;
  diasMaximos?: number;
  activo: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COLORES = ["#2563EB", "#ef4444", "#f59e0b", "#10b981", "#ec4899", "#06b6d4", "#8b5cf6", "#f97316", "#84cc16", "#6b7280"];

const EVENTOS_NOTIF = [
  { key: "Ausencias", label: "Ausencias", desc: "Solicitudes y cambios de estado de ausencias" },
  { key: "Turnos", label: "Turnos", desc: "Publicación y modificaciones de turnos" },
  { key: "Tareas", label: "Tareas", desc: "Asignación y actualizaciones de tareas" },
  { key: "Fichajes", label: "Fichajes", desc: "Alertas de fichaje (tardanzas, ausencias)" },
  { key: "Comunicados", label: "Comunicados", desc: "Publicación de nuevos comunicados" },
  { key: "Documentos", label: "Documentos", desc: "Cuando se envía un documento a un empleado" },
  {
    key: "FueraSede",
    label: "Fichajes fuera de la sede",
    desc: "Avisa por email a administradores y responsables cuando alguien ficha más lejos del radio de su sede",
  },
] as const;

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-700 flex-1 min-w-0">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${value ? "bg-[var(--primary)]" : "bg-slate-200"}`}
      >
        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${value ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}

// ── Tab type ─────────────────────────────────────────────────────────────────

type Tab = "general" | "ausencias" | "checklist" | "catalogo" | "notificaciones" | "branding" | "calendario" | "dominio" | "nomina";

const TABS: Tab[] = ["general", "ausencias", "checklist", "catalogo", "notificaciones", "branding", "calendario", "dominio", "nomina"];

// ── Page ──────────────────────────────────────────────────────────────────────

function ConfiguracionPageInner() {
  const { toast } = useToast();
  // Permite enlazar directamente a una pestaña concreta (p. ej. desde
  // /admin/ausencias → ?tab=ausencias para gestionar los tipos de ausencia).
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(tabParam && TABS.includes(tabParam) ? tabParam : "general");
  // Con features aún sin cargar no se pinta la pestaña: es preferible que
  // aparezca un instante después que enseñarla a quien no la tiene.
  const { data: featuresData } = useFeatures();
  const tieneCierreTurno = featuresData?.booleans?.cierre_turno === true;
  const [config, setConfig] = useState<Configuracion | null>(null);
  const [tipos, setTipos] = useState<TipoAusencia[]>([]);
  const [saving, setSaving] = useState(false);
  const [savingNotif, setSavingNotif] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editandoTipo, setEditandoTipo] = useState<TipoAusencia | null>(null);
  // Reset del sistema eliminado en Fase 4 (legacy mono-tenant).
  const [showPassword, setShowPassword] = useState(false);
  const [generatingVapid, setGeneratingVapid] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [tipoForm, setTipoForm] = useState({
    nombre: "", color: "#2563EB", pagada: true,
    requiereAprobacion: true, diasMaximos: "",
  });

  const DEFAULT_CONFIG: Configuracion = {
    id: "singleton", nombre: "Mi Empresa",
    horasJornadaDiaria: 8, horasSemanales: 40, toleranciaFichaje: 15,
    geofencingActivo: true, geoObligatoria: false, faceIdObligatorio: false, faceIdGuardarFoto: false,
    retencionFotosDias: 90,
    fichajeMovilActivo: true, fichajeTabletActivo: true,
    notifAusencias: true, notifTurnos: true, notifTareas: true,
    notifFichajes: false, notifComunicados: true, notifDocumentos: true,
    notifFueraSede: true,
    emailActivo: false, emailHost: "", emailPort: 587, emailSecure: true,
    emailUser: "", emailPassword: "", emailFrom: "",
    pushActivo: false, pushVapidPublicKey: null,
    appNombre: "empleaIA", logo: null, favicon: null,
    colorPrimario: "#2563EB", colorSidebar: "#0F172A",
    zonaHoraria: "Europe/Madrid", diasLaborables: [1, 2, 3, 4, 5],
    nominaJornadaSemanal: 40,
    nominaHoraExtraFactor: 1.75,
    nominaPlusNocturnidadActivo: false,
    nominaNocturnidadDesde: "22:00",
    nominaNocturnidadHasta: "06:00",
    nominaPlusNocturnidadFactor: 1.25,
    nominaPlusFestivoActivo: false,
    nominaPlusFestivoFactor: 1.75,
    nominaSalarioBaseDefault: 0,
    nominaMoneda: "EUR",
  };

  const fetchData = useCallback(async () => {
    const [configRes, tipRes] = await Promise.all([
      fetch("/api/configuracion"),
      fetch("/api/ausencias/tipos"),
    ]);
    const [configData, tiposData] = await Promise.all([configRes.json(), tipRes.json()]);
    setConfig({ ...DEFAULT_CONFIG, ...configData });
    setTipos(Array.isArray(tiposData) ? tiposData : (tiposData?.tipos ?? []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Save general ────────────────────────────────────────────────────────────

  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: config.nombre,
          horasJornadaDiaria: config.horasJornadaDiaria,
          horasSemanales: config.horasSemanales,
          toleranciaFichaje: config.toleranciaFichaje,
          geofencingActivo: config.geofencingActivo,
          geoObligatoria: config.geoObligatoria,
          faceIdObligatorio: config.faceIdObligatorio,
          faceIdGuardarFoto: config.faceIdGuardarFoto,
          retencionFotosDias: config.retencionFotosDias,
          fichajeMovilActivo: config.fichajeMovilActivo,
          fichajeTabletActivo: config.fichajeTabletActivo,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Configuración guardada" });
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Save notifications ──────────────────────────────────────────────────────

  const handleSaveNotif = async () => {
    if (!config) return;
    setSavingNotif(true);
    try {
      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notifAusencias: config.notifAusencias,
          notifTurnos: config.notifTurnos,
          notifTareas: config.notifTareas,
          notifFichajes: config.notifFichajes,
          notifComunicados: config.notifComunicados,
          notifDocumentos: config.notifDocumentos,
          notifFueraSede: config.notifFueraSede,
          emailActivo: config.emailActivo,
          emailHost: config.emailHost,
          emailPort: config.emailPort,
          emailSecure: config.emailSecure,
          emailUser: config.emailUser,
          emailPassword: config.emailPassword,
          emailFrom: config.emailFrom,
          pushActivo: config.pushActivo,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Configuración de notificaciones guardada" });
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSavingNotif(false);
    }
  };

  // ── Save branding ───────────────────────────────────────────────────────────

  const handleSaveBranding = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/configuracion/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appNombre: config.appNombre,
          nombre: config.nombre,
          logo: config.logo,
          favicon: config.favicon,
          colorPrimario: config.colorPrimario,
          colorSidebar: config.colorSidebar,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Error desconocido");
      }
      toast({ title: "Branding guardado. Recarga para ver los cambios." });
    } catch (e: unknown) {
      toast({
        title: e instanceof Error ? e.message : "Error al guardar",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = (
    field: "logo" | "favicon",
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "El archivo no puede superar 2 MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setConfig((c) => c && { ...c, [field]: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  // ── Generate VAPID ──────────────────────────────────────────────────────────

  const handleGenerarVapid = async () => {
    setGeneratingVapid(true);
    try {
      const res = await fetch("/api/push/generar-vapid", { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setConfig((c) => c && { ...c, pushVapidPublicKey: data.publicKey });
      toast({ title: "Claves VAPID generadas correctamente" });
    } catch {
      toast({ title: "Error al generar claves VAPID", variant: "destructive" });
    } finally {
      setGeneratingVapid(false);
    }
  };

  // ── Test email ──────────────────────────────────────────────────────────────

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      const res = await fetch("/api/configuracion/test-email", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error desconocido");
      toast({ title: "Email de prueba enviado a tu dirección" });
    } catch (e: any) {
      toast({ title: "Error SMTP", description: e.message, variant: "destructive" });
    } finally {
      setTestingEmail(false);
    }
  };

  // ── Tipo ausencia ───────────────────────────────────────────────────────────

  const abrirCrearTipo = () => {
    setEditandoTipo(null);
    setTipoForm({ nombre: "", color: "#6366f1", pagada: true, requiereAprobacion: true, diasMaximos: "" });
    setDialogOpen(true);
  };

  const abrirEditarTipo = (t: TipoAusencia) => {
    setEditandoTipo(t);
    setTipoForm({
      nombre: t.nombre, color: t.color, pagada: t.pagada,
      requiereAprobacion: t.requiereAprobacion, diasMaximos: t.diasMaximos?.toString() || "",
    });
    setDialogOpen(true);
  };

  const handleSaveTipo = async () => {
    if (!tipoForm.nombre) { toast({ title: "El nombre es obligatorio", variant: "destructive" }); return; }
    try {
      const body = { ...tipoForm, diasMaximos: tipoForm.diasMaximos ? parseInt(tipoForm.diasMaximos) : null };
      if (editandoTipo) {
        const res = await fetch(`/api/ausencias/tipos/${editandoTipo.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error();
        toast({ title: "Tipo actualizado" });
      } else {
        const res = await fetch("/api/ausencias/tipos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error();
        toast({ title: "Tipo de ausencia creado" });
      }
      setDialogOpen(false);
      fetchData();
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    }
  };

  const handleDeleteTipo = async (t: TipoAusencia) => {
    if (!confirm(`¿Eliminar el tipo de ausencia "${t.nombre}"? Las ausencias existentes seguirán refiriéndose a él.`)) return;
    try {
      const res = await fetch(`/api/ausencias/tipos/${t.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ title: "Tipo eliminado" });
      fetchData();
    } catch {
      toast({ title: "Error al eliminar", variant: "destructive" });
    }
  };

  // handleReset eliminado en Fase 4 (legacy mono-tenant).

  if (!config) return <div className="p-6 animate-pulse"><div className="h-40 bg-slate-100 rounded-xl" /></div>;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Configuración</h1>
        <p className="text-slate-500 text-sm mt-1">Parámetros generales de la empresa</p>
      </div>

      <PlanUsageCard />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.filter((t) => t !== "catalogo" || tieneCierreTurno).map((t) => {
          const labels: Record<Tab, string> = {
            general: "General",
            ausencias: "Tipos de ausencia",
            checklist: "Checklist de fichaje",
            catalogo: "Catálogo de ventas",
            notificaciones: "Notificaciones",
            branding: "Branding",
            calendario: "Calendario",
            dominio: "Dominio",
            nomina: "Nómina",
          };
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* ── TAB: General ──────────────────────────────────────────────────────── */}
      {tab === "general" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4 text-[var(--primary)]" /> General
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Nombre de la empresa</Label>
                <Input
                  className="mt-1"
                  value={config.nombre}
                  onChange={(e) => setConfig((c) => c && ({ ...c, nombre: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Horas jornada diaria</Label>
                  <Input className="mt-1" type="number" min="1" max="24"
                    value={config.horasJornadaDiaria}
                    onChange={(e) => setConfig((c) => c && ({ ...c, horasJornadaDiaria: parseFloat(e.target.value) }))} />
                </div>
                <div>
                  <Label>Horas semanales</Label>
                  <Input className="mt-1" type="number"
                    value={config.horasSemanales}
                    onChange={(e) => setConfig((c) => c && ({ ...c, horasSemanales: parseFloat(e.target.value) }))} />
                </div>
                <div>
                  <Label>Tolerancia fichaje (min)</Label>
                  <Input className="mt-1" type="number" min="0"
                    value={config.toleranciaFichaje}
                    onChange={(e) => setConfig((c) => c && ({ ...c, toleranciaFichaje: parseInt(e.target.value) }))} />
                </div>
              </div>
              <div className="pt-2">
                <Toggle label="Geofencing activo (validar ubicación al fichar)" value={config.geofencingActivo} onChange={(v) => setConfig((c) => c && ({ ...c, geofencingActivo: v }))} />
                <Toggle label="Geolocalización obligatoria al fichar (rechaza fichaje si el navegador no envía coordenadas)" value={config.geoObligatoria} onChange={(v) => setConfig((c) => c && ({ ...c, geoObligatoria: v }))} />
                <Toggle label="Face ID obligatorio (empleados con rostro registrado deben verificarlo al fichar)" value={config.faceIdObligatorio} onChange={(v) => setConfig((c) => c && ({ ...c, faceIdObligatorio: v }))} />
                <Toggle label="Guardar foto al fichar con Face ID (dato biométrico — RGPD art. 9, requiere consentimiento explícito de los empleados)" value={config.faceIdGuardarFoto} onChange={(v) => setConfig((c) => c && ({ ...c, faceIdGuardarFoto: v }))} />
                {config.faceIdGuardarFoto && (
                  <div className="ml-6 mt-2 mb-3 p-3 rounded-md bg-amber-50 border border-amber-200">
                    <Label className="text-sm font-medium">Días de retención de la foto biométrica</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        className="w-32"
                        value={config.retencionFotosDias}
                        onChange={(e) => {
                          const v = parseInt(e.target.value);
                          setConfig((c) => c && ({ ...c, retencionFotosDias: Number.isNaN(v) ? 90 : v }));
                        }}
                      />
                      <span className="text-sm text-muted-foreground">días (default: 90)</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      RGPD art. 5.1.e (minimización). Tras este periodo, el cron diario purga el snapshot cifrado. Los fichajes se conservan; solo se borra la foto.
                    </p>
                  </div>
                )}
                <Toggle label="Fichaje desde móvil" value={config.fichajeMovilActivo} onChange={(v) => setConfig((c) => c && ({ ...c, fichajeMovilActivo: v }))} />
                <Toggle label="Fichaje desde tablet (kiosko)" value={config.fichajeTabletActivo} onChange={(v) => setConfig((c) => c && ({ ...c, fichajeTabletActivo: v }))} />
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={handleSaveConfig} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? "Guardando..." : "Guardar cambios"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Fase 4: el reset del sistema se eliminó. En multi-tenant no
              tiene sentido un wipe global desde la UI del tenant — el
              control plane (master.tenants) se gestiona desde el panel
              super-admin (Fase 7). */}
        </>
      )}

      {/* ── TAB: Ausencias ────────────────────────────────────────────────────── */}
      {tab === "ausencias" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[var(--primary)]" /> Tipos de Ausencia
              </CardTitle>
              <Button size="sm" onClick={abrirCrearTipo}>
                <Plus className="h-4 w-4 mr-1" /> Añadir
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {tipos.length === 0 ? (
              <p className="text-center py-8 text-slate-400">No hay tipos de ausencia</p>
            ) : (
              <div className="divide-y">
                {tipos.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-6 py-3 hover:bg-slate-50">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{t.nombre}</p>
                      <p className="text-xs text-slate-400">
                        {t.pagada ? "Pagada" : "No pagada"} ·{" "}
                        {t.requiereAprobacion ? "Requiere aprobación" : "Aprobación automática"}{" "}
                        {t.diasMaximos ? `· Máx. ${t.diasMaximos} días` : ""}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditarTipo(t)} title="Editar">
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDeleteTipo(t)} title="Eliminar">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── TAB: Notificaciones ───────────────────────────────────────────────── */}
      {tab === "notificaciones" && (
        <div className="space-y-6">

          {/* Eventos globales */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-4 w-4 text-[var(--primary)]" /> Eventos que generan notificaciones
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {EVENTOS_NOTIF.map(({ key, label, desc }) => {
                  const field = `notif${key}` as keyof Configuracion;
                  const value = config[field] as boolean;
                  return (
                    <div key={key} className="flex items-center justify-between px-6 py-3 hover:bg-slate-50">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{label}</p>
                        <p className="text-xs text-slate-400">{desc}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfig((c) => c && { ...c, [field]: !value })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value ? "bg-[var(--primary)]" : "bg-slate-200"}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? "translate-x-6" : "translate-x-1"}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Email (Resend) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="h-4 w-4 text-[var(--primary)]" /> Correo electrónico (Resend)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Toggle
                label="Activar notificaciones por email"
                value={config.emailActivo}
                onChange={(v) => setConfig((c) => c && ({ ...c, emailActivo: v }))}
              />
              {config.emailActivo && (
                <>
                  <div>
                    <Label>API Key de Resend</Label>
                    <div className="relative mt-1">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="re_••••••••••••••••••••••••"
                        value={config.emailPassword}
                        onChange={(e) => setConfig((c) => c && ({ ...c, emailPassword: e.target.value }))}
                        className="pr-9 font-mono text-sm"
                      />
                      <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        onClick={() => setShowPassword((s) => !s)}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">Obtén tu API Key en resend.com → API Keys</p>
                  </div>
                  <div>
                    <Label>Remitente (From)</Label>
                    <Input className="mt-1" placeholder="Empresa &lt;noreply@tudominio.com&gt;"
                      value={config.emailFrom}
                      onChange={(e) => setConfig((c) => c && ({ ...c, emailFrom: e.target.value }))} />
                    <p className="text-xs text-slate-400 mt-1">El dominio debe estar verificado en Resend</p>
                  </div>
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={handleTestEmail} disabled={testingEmail}>
                      {testingEmail ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                      Enviar email de prueba
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Push */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-[var(--primary)]" /> Notificaciones push
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Toggle
                label="Activar notificaciones push"
                value={config.pushActivo}
                onChange={(v) => setConfig((c) => c && ({ ...c, pushActivo: v }))}
              />
              {config.pushActivo && (
                <div>
                  <Label>Clave pública VAPID</Label>
                  {config.pushVapidPublicKey ? (
                    <div className="mt-1 flex items-center gap-2">
                      <code className="flex-1 text-xs bg-slate-50 border rounded px-3 py-2 text-slate-600 break-all">
                        {config.pushVapidPublicKey}
                      </code>
                      <span className="flex-shrink-0 text-emerald-500"><Check className="h-4 w-4" /></span>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex-1 text-xs bg-slate-50 border border-dashed rounded px-3 py-2 text-slate-400 flex items-center gap-2">
                        <X className="h-3 w-3" /> Sin claves VAPID configuradas
                      </div>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={handleGenerarVapid}
                    disabled={generatingVapid}
                  >
                    {generatingVapid ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    {config.pushVapidPublicKey ? "Regenerar claves VAPID" : "Generar claves VAPID"}
                  </Button>
                  {config.pushVapidPublicKey && (
                    <p className="text-xs text-amber-600 mt-1">
                      ⚠ Regenerar claves invalidará todas las suscripciones existentes.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSaveNotif} disabled={savingNotif}>
              <Save className="h-4 w-4 mr-2" />
              {savingNotif ? "Guardando..." : "Guardar configuración"}
            </Button>
          </div>
        </div>
      )}

      {/* ── TAB: Branding ────────────────────────────────────────────────────── */}
      {tab === "branding" && (
        <FeatureGateClient
          feature="branding_personalizado"
          fallback={
            <div className="space-y-4">
              <UpsellCTA feature="branding_personalizado" />
              <p className="text-sm text-slate-500 text-center">
                Tu plan actual no permite personalizar el branding (logo,
                colores, nombre de la app). Actualiza tu plan para acceder a
                esta función.
              </p>
            </div>
          }
        >
        <div className="space-y-6">

          {/* Identidad */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="h-4 w-4 text-[var(--primary)]" /> Identidad de la app
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Nombre de la app</Label>
                  <Input className="mt-1" placeholder="empleaIA"
                    value={config.appNombre}
                    onChange={(e) => setConfig((c) => c && ({ ...c, appNombre: e.target.value }))} />
                  <p className="text-xs text-slate-400 mt-1">Aparece en el título del navegador y emails</p>
                </div>
                <div>
                  <Label>Nombre de la empresa</Label>
                  <Input className="mt-1" placeholder="Mi Empresa"
                    value={config.nombre}
                    onChange={(e) => setConfig((c) => c && ({ ...c, nombre: e.target.value }))} />
                  <p className="text-xs text-slate-400 mt-1">Aparece en emails y cabeceras</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Colores */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="h-4 w-4 text-[var(--primary)]" /> Colores
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <Label>Color primario</Label>
                  <p className="text-xs text-slate-400 mb-2">Botones, elementos activos, focus</p>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg border-2 border-slate-200 shadow-sm flex-shrink-0 cursor-pointer overflow-hidden relative"
                      style={{ backgroundColor: config.colorPrimario }}
                    >
                      <input
                        type="color"
                        value={config.colorPrimario}
                        onChange={(e) => setConfig((c) => c && ({ ...c, colorPrimario: e.target.value }))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                    <Input
                      value={config.colorPrimario}
                      onChange={(e) => setConfig((c) => c && ({ ...c, colorPrimario: e.target.value }))}
                      className="font-mono text-sm"
                      maxLength={7}
                      placeholder="#6366f1"
                    />
                  </div>
                  {/* Preset colors */}
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {["#6366f1","#8b5cf6","#ec4899","#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#06b6d4","#3b82f6","#1d4ed8","#374151"].map((c) => (
                      <button key={c} type="button"
                        onClick={() => setConfig((cfg) => cfg && ({ ...cfg, colorPrimario: c }))}
                        className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                        style={{
                          backgroundColor: c,
                          borderColor: config.colorPrimario === c ? "#1f2937" : "transparent",
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <Label>Color del sidebar</Label>
                  <p className="text-xs text-slate-400 mb-2">Fondo de la barra lateral de navegación</p>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg border-2 border-slate-200 shadow-sm flex-shrink-0 cursor-pointer overflow-hidden relative"
                      style={{ backgroundColor: config.colorSidebar }}
                    >
                      <input
                        type="color"
                        value={config.colorSidebar}
                        onChange={(e) => setConfig((c) => c && ({ ...c, colorSidebar: e.target.value }))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                    <Input
                      value={config.colorSidebar}
                      onChange={(e) => setConfig((c) => c && ({ ...c, colorSidebar: e.target.value }))}
                      className="font-mono text-sm"
                      maxLength={7}
                      placeholder="#1e1b4b"
                    />
                  </div>
                  {/* Preset sidebar colors */}
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {["#1e1b4b","#0f172a","#1e293b","#111827","#1c1917","#14142b","#0a0a23","#1a1a2e","#16213e","#0d1117","#1f2937","#030712"].map((c) => (
                      <button key={c} type="button"
                        onClick={() => setConfig((cfg) => cfg && ({ ...cfg, colorSidebar: c }))}
                        className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                        style={{
                          backgroundColor: c,
                          borderColor: config.colorSidebar === c ? "#6b7280" : "transparent",
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="mt-2 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                <div className="flex" style={{ height: "80px" }}>
                  <div className="w-28 flex flex-col" style={{ backgroundColor: config.colorSidebar }}>
                    <div className="flex items-center gap-1.5 px-2 py-2">
                      <div className="w-4 h-4 rounded flex-shrink-0" style={{ backgroundColor: config.colorPrimario }} />
                      <div className="h-2 w-12 bg-white/30 rounded" />
                    </div>
                    <div className="mx-2 rounded px-2 py-1 flex items-center gap-1" style={{ backgroundColor: config.colorPrimario }}>
                      <div className="w-2.5 h-2.5 bg-white/80 rounded-sm" />
                      <div className="h-1.5 w-10 bg-white/70 rounded" />
                    </div>
                    <div className="mx-2 mt-0.5 rounded px-2 py-1 flex items-center gap-1">
                      <div className="w-2.5 h-2.5 bg-white/30 rounded-sm" />
                      <div className="h-1.5 w-8 bg-white/25 rounded" />
                    </div>
                  </div>
                  <div className="flex-1 bg-slate-50 flex flex-col">
                    <div className="h-8 border-b border-slate-200 bg-white flex items-center px-3 gap-2">
                      <div className="h-2 w-16 bg-slate-200 rounded" />
                      <div className="ml-auto h-5 w-5 rounded-full" style={{ backgroundColor: config.colorPrimario + "40" }} />
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                      <div className="h-5 w-20 rounded" style={{ backgroundColor: config.colorPrimario }} />
                    </div>
                  </div>
                </div>
                <div className="bg-slate-50 border-t border-slate-200 px-3 py-1.5 text-center">
                  <span className="text-xs text-slate-400">Vista previa</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Logo */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Image className="h-4 w-4 text-[var(--primary)]" /> Logo de la empresa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-500">El logo aparece en los emails y en la cabecera del sidebar. Formatos: PNG, JPG, SVG. Máx. 2 MB.</p>
              <div className="flex items-start gap-4">
                {/* Preview */}
                <div className="w-32 h-20 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center bg-slate-50 flex-shrink-0 overflow-hidden">
                  {config.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={config.logo} alt="Logo" className="max-w-full max-h-full object-contain p-2" />
                  ) : (
                    <div className="text-center">
                      <Image className="h-6 w-6 text-slate-300 mx-auto mb-1" />
                      <span className="text-xs text-slate-400">Sin logo</span>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="cursor-pointer">
                    <div className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700">
                      <Upload className="h-4 w-4" />
                      Subir logo
                    </div>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => handleFileUpload("logo", e)} />
                  </label>
                  {config.logo && (
                    <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600"
                      onClick={() => setConfig((c) => c && ({ ...c, logo: null }))}>
                      <X className="h-3.5 w-3.5 mr-1" /> Eliminar logo
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Favicon */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Image className="h-4 w-4 text-[var(--primary)]" /> Favicon
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-500">Icono que aparece en la pestaña del navegador. Usa un PNG cuadrado de 32×32 o 64×64 px. Máx. 2 MB.</p>
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center bg-slate-50 flex-shrink-0 overflow-hidden">
                  {config.favicon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={config.favicon} alt="Favicon" className="w-8 h-8 object-contain" />
                  ) : (
                    <Image className="h-5 w-5 text-slate-300" />
                  )}
                </div>
                <div className="space-y-2">
                  <label className="cursor-pointer">
                    <div className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700">
                      <Upload className="h-4 w-4" />
                      Subir favicon
                    </div>
                    <input type="file" accept="image/png,image/x-icon,image/svg+xml" className="hidden"
                      onChange={(e) => handleFileUpload("favicon", e)} />
                  </label>
                  {config.favicon && (
                    <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600"
                      onClick={() => setConfig((c) => c && ({ ...c, favicon: null }))}>
                      <X className="h-3.5 w-3.5 mr-1" /> Eliminar favicon
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSaveBranding} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Guardando..." : "Guardar branding"}
            </Button>
          </div>
        </div>
        </FeatureGateClient>
      )}

      {/* ── TAB: Calendario ───────────────────────────────────────────────────── */}
      {tab === "calendario" && (
        <CalendarioTab
          zonaHoraria={config.zonaHoraria}
          diasLaborables={config.diasLaborables}
          onUpdateConfig={(patch) => setConfig((c) => c && ({ ...c, ...patch }))}
        />
      )}

      {/* ── TAB: Checklist de fichaje (ticket c4bc33d6) ───────────────────────── */}
      {tab === "checklist" && <ChecklistFichajeTab />}
      {/* Solo con el módulo de cierre de turno contratado: sin él, esta tabla
          no la usa nadie y la pestaña sería ruido. */}
      {tab === "catalogo" && (
        <FeatureGateClient feature="cierre_turno">
          <CatalogoVentasTab />
        </FeatureGateClient>
      )}

      {/* ── TAB: Dominio ──────────────────────────────────────────────────────── */}
      {tab === "dominio" && <DominioTab />}

      {/* ── TAB: Nómina (reglas de cálculo de prenómina) ─────────────────────── */}
      {tab === "nomina" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reglas de cálculo de prenómina</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-500 -mt-2">
                Estos valores se aplican al calcular la prenómina mensual. Las
                horas trabajadas por encima de la jornada mensual cuentan como
                extras. Plus de nocturnidad y festivos son opcionales.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Jornada semanal (horas)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    className="mt-1"
                    value={config.nominaJornadaSemanal ?? 40}
                    onChange={(e) =>
                      setConfig({ ...config, nominaJornadaSemanal: parseFloat(e.target.value) || 0 })
                    }
                  />
                </div>
                <div>
                  <Label>Salario base mensual por defecto (€)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    className="mt-1"
                    value={config.nominaSalarioBaseDefault ?? 0}
                    onChange={(e) =>
                      setConfig({ ...config, nominaSalarioBaseDefault: parseFloat(e.target.value) || 0 })
                    }
                  />
                </div>
                <div>
                  <Label>Factor hora extra (×)</Label>
                  <Input
                    type="number"
                    step="0.05"
                    className="mt-1"
                    value={config.nominaHoraExtraFactor ?? 1.75}
                    onChange={(e) =>
                      setConfig({ ...config, nominaHoraExtraFactor: parseFloat(e.target.value) || 1 })
                    }
                  />
                  <p className="text-xs text-slate-500 mt-1">Multiplicador sobre el precio/hora.</p>
                </div>
                <div>
                  <Label>Moneda</Label>
                  <Input
                    className="mt-1"
                    value={config.nominaMoneda ?? "EUR"}
                    onChange={(e) =>
                      setConfig({ ...config, nominaMoneda: e.target.value.toUpperCase().slice(0, 3) })
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Plus de nocturnidad</CardTitle>
            </CardHeader>
            <CardContent>
              <Toggle
                value={config.nominaPlusNocturnidadActivo ?? false}
                onChange={(v) => setConfig({ ...config, nominaPlusNocturnidadActivo: v })}
                label="Aplicar plus de nocturnidad"
              />
              {(config.nominaPlusNocturnidadActivo ?? false) && (
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div>
                    <Label>Desde</Label>
                    <Input
                      type="time"
                      className="mt-1"
                      value={config.nominaNocturnidadDesde ?? "22:00"}
                      onChange={(e) => setConfig({ ...config, nominaNocturnidadDesde: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Hasta</Label>
                    <Input
                      type="time"
                      className="mt-1"
                      value={config.nominaNocturnidadHasta ?? "06:00"}
                      onChange={(e) => setConfig({ ...config, nominaNocturnidadHasta: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Factor (×)</Label>
                    <Input
                      type="number"
                      step="0.05"
                      className="mt-1"
                      value={config.nominaPlusNocturnidadFactor ?? 1.25}
                      onChange={(e) =>
                        setConfig({ ...config, nominaPlusNocturnidadFactor: parseFloat(e.target.value) || 1 })
                      }
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Plus de festivos</CardTitle>
            </CardHeader>
            <CardContent>
              <Toggle
                value={config.nominaPlusFestivoActivo ?? false}
                onChange={(v) => setConfig({ ...config, nominaPlusFestivoActivo: v })}
                label="Aplicar plus por trabajar en festivo"
              />
              {(config.nominaPlusFestivoActivo ?? false) && (
                <div className="mt-4 max-w-xs">
                  <Label>Factor (×)</Label>
                  <Input
                    type="number"
                    step="0.05"
                    className="mt-1"
                    value={config.nominaPlusFestivoFactor ?? 1.75}
                    onChange={(e) =>
                      setConfig({ ...config, nominaPlusFestivoFactor: parseFloat(e.target.value) || 1 })
                    }
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Multiplicador sobre el precio/hora cuando el día está marcado como festivo en el calendario.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={async () => {
                if (!config) return;
                setSaving(true);
                try {
                  const res = await fetch("/api/configuracion", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      nominaJornadaSemanal: config.nominaJornadaSemanal,
                      nominaHoraExtraFactor: config.nominaHoraExtraFactor,
                      nominaPlusNocturnidadActivo: config.nominaPlusNocturnidadActivo,
                      nominaNocturnidadDesde: config.nominaNocturnidadDesde,
                      nominaNocturnidadHasta: config.nominaNocturnidadHasta,
                      nominaPlusNocturnidadFactor: config.nominaPlusNocturnidadFactor,
                      nominaPlusFestivoActivo: config.nominaPlusFestivoActivo,
                      nominaPlusFestivoFactor: config.nominaPlusFestivoFactor,
                      nominaSalarioBaseDefault: config.nominaSalarioBaseDefault,
                      nominaMoneda: config.nominaMoneda,
                    }),
                  });
                  if (!res.ok) throw new Error();
                  toast({ title: "Reglas de nómina guardadas" });
                } catch {
                  toast({ title: "Error al guardar", variant: "destructive" });
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Guardando..." : "Guardar reglas"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Dialogs ───────────────────────────────────────────────────────────── */}

      {/* Reset dialog eliminado en Fase 4 (legacy mono-tenant). */}

      {/* Tipo ausencia dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editandoTipo ? "Editar Tipo" : "Nuevo Tipo de Ausencia"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre *</Label>
              <Input className="mt-1" value={tipoForm.nombre} onChange={(e) => setTipoForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Vacaciones" />
            </div>
            <div>
              <Label>Color</Label>
              <div className="mt-1 flex gap-2 flex-wrap">
                {COLORES.map((c) => (
                  <button key={c} type="button"
                    className={`w-7 h-7 rounded-full border-2 transition-all ${tipoForm.color === c ? "border-slate-800 scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setTipoForm((f) => ({ ...f, color: c }))}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label>Días máximos (vacío = ilimitado)</Label>
              <Input className="mt-1" type="number" min="1" value={tipoForm.diasMaximos}
                onChange={(e) => setTipoForm((f) => ({ ...f, diasMaximos: e.target.value }))} placeholder="22" />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={tipoForm.pagada} onChange={(e) => setTipoForm((f) => ({ ...f, pagada: e.target.checked }))} className="rounded" />
                <span className="text-sm text-slate-700">Ausencia pagada</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={tipoForm.requiereAprobacion} onChange={(e) => setTipoForm((f) => ({ ...f, requiereAprobacion: e.target.checked }))} className="rounded" />
                <span className="text-sm text-slate-700">Requiere aprobación del manager</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveTipo}>{editandoTipo ? "Actualizar" : "Crear Tipo"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// `useSearchParams` exige un límite de Suspense en Next 16 (igual que en
// /admin/aceptar-invitacion). Envolvemos el contenido para no romper el SSG.
export default function ConfiguracionPage() {
  return (
    <Suspense fallback={<div className="p-6 animate-pulse"><div className="h-40 bg-slate-100 rounded-xl" /></div>}>
      <ConfiguracionPageInner />
    </Suspense>
  );
}
