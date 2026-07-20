"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, FolderOpen, Folder, Trash2, FileText, Download, ArrowLeft, Settings2, Pencil, X, LayoutTemplate, Send } from "lucide-react";
import { isSafeDocUrl, openDocInNewTab } from "@/lib/documentos/url";
import { esCarpetaFirmaObligatoria } from "@/lib/documentos/categorias";
import { CAMPO_TIPOS, CAMPO_TIPO_LABEL, type CampoPlantilla, type CampoTipo } from "@/lib/documentos/campos";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Documento {
  id: string;
  nombre: string;
  descripcion?: string;
  url?: string;
  tipo: string;
  user?: { nombre: string; apellidos: string };
  subidoPor: { nombre: string; apellidos: string };
  createdAt: string;
}

interface Empleado { id: string; nombre: string; apellidos: string; }
interface TipoDoc { id: string; nombre: string; slug: string; orden: number; }
interface Plantilla {
  id: string;
  nombre: string;
  descripcion?: string | null;
  url?: string | null;
  tipo: string;
  campos: CampoPlantilla[];
  solicitarFirma: boolean;
  createdBy?: { nombre: string; apellidos: string };
}

const PLANTILLA_FORM_INICIAL = {
  nombre: "",
  descripcion: "",
  url: "",
  tipo: "",
  solicitarFirma: false,
  campos: [] as CampoPlantilla[],
};

// Radix Select prohíbe SelectItem con value="" (lanza en runtime). Usamos un
// centinela para la opción "Documento general" y lo traducimos a "" (→ null).
const GENERAL = "__general__";

export default function AdminDocumentosPage() {
  const { toast } = useToast();
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [tipos, setTipos] = useState<TipoDoc[]>([]);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState<"carpetas" | "plantillas">("carpetas");
  const [carpeta, setCarpeta] = useState<string | null>(null); // slug de la carpeta abierta
  const [dialogOpen, setDialogOpen] = useState(false);
  const [gestionOpen, setGestionOpen] = useState(false);
  // Modo del diálogo "Añadir documento": subir uno nuevo, o adjuntar una plantilla.
  const [docMode, setDocMode] = useState<"nuevo" | "plantilla">("nuevo");
  const [docPlantillaId, setDocPlantillaId] = useState("");
  const [form, setForm] = useState({ nombre: "", descripcion: "", url: "", tipo: "", userId: "" });
  const [solicitarFirma, setSolicitarFirma] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nuevoTipo, setNuevoTipo] = useState("");
  // Editor de plantillas.
  const [plantillaDialogOpen, setPlantillaDialogOpen] = useState(false);
  const [editandoPlantilla, setEditandoPlantilla] = useState<Plantilla | null>(null);
  const [plantillaForm, setPlantillaForm] = useState(PLANTILLA_FORM_INICIAL);
  const [savingPlantilla, setSavingPlantilla] = useState(false);
  // Envío de una plantilla a empleados.
  const [enviarPlantilla, setEnviarPlantilla] = useState<Plantilla | null>(null);
  const [enviarUserIds, setEnviarUserIds] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, empRes, tiposRes, plantillasRes] = await Promise.all([
        fetch("/api/documentos"),
        fetch("/api/empleados"),
        fetch("/api/documentos/tipos"),
        fetch("/api/documentos/plantillas"),
      ]);
      const [docsData, empData, tiposData, plantillasData] = await Promise.all([
        docsRes.json(), empRes.json(), tiposRes.json(), plantillasRes.json().catch(() => ({})),
      ]);
      setDocumentos(docsData.documentos || []);
      setEmpleados(empData.empleados || []);
      setTipos(tiposData.tipos || []);
      setPlantillas(plantillasData.plantillas || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Carpetas = catálogo de tipos + tipos "huérfanos" presentes en documentos.
  const slugSet = new Set(tipos.map((t) => t.slug));
  const huérfanos = [...new Set(documentos.map((d) => d.tipo).filter(Boolean))].filter((s) => !slugSet.has(s));
  const carpetas = [
    ...tipos.map((t) => ({ slug: t.slug, nombre: t.nombre, gestionable: true })),
    ...huérfanos.map((s) => ({ slug: s, nombre: s, gestionable: false })),
  ].map((c) => ({ ...c, count: documentos.filter((d) => d.tipo === c.slug).length }));

  const nombreCarpeta = (slug: string) => carpetas.find((c) => c.slug === slug)?.nombre ?? slug;

  const handleCreate = async () => {
    if (!form.nombre) { toast({ title: "El nombre es obligatorio", variant: "destructive" }); return; }
    const tipo = form.tipo || carpeta || tipos[0]?.slug || "otro";
    // La carpeta de contratos exige firma obligatoria; en el resto es opcional.
    const firmaOblig = esCarpetaFirmaObligatoria(tipo);
    const pedirFirma = firmaOblig || solicitarFirma;
    if (pedirFirma && !form.userId) {
      toast({ title: "Elige el empleado que debe firmar el documento", variant: "destructive" });
      return;
    }
    if (pedirFirma && !isSafeDocUrl(form.url)) {
      toast({
        title: firmaOblig
          ? "Añade la URL del contrato para que el empleado pueda firmarlo"
          : "Añade la URL del documento para poder solicitar su firma",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/documentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, tipo, userId: form.userId || null, solicitarFirma: pedirFirma }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Error al guardar");
      const data = await res.json().catch(() => ({}));
      toast({
        title: data.firmaSolicitada ? "Documento añadido y firma solicitada al empleado" : "Documento añadido",
        variant: "success",
      });
      setDialogOpen(false);
      setForm({ nombre: "", descripcion: "", url: "", tipo: "", userId: "" });
      setSolicitarFirma(false);
      fetchData();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/documentos/${id}`, { method: "DELETE" });
      toast({ title: "Documento eliminado", variant: "success" });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  // ─── Plantillas ───
  const abrirCrearPlantilla = () => {
    setEditandoPlantilla(null);
    setPlantillaForm({ ...PLANTILLA_FORM_INICIAL, tipo: tipos[0]?.slug ?? "" });
    setPlantillaDialogOpen(true);
  };

  const abrirEditarPlantilla = (p: Plantilla) => {
    setEditandoPlantilla(p);
    setPlantillaForm({
      nombre: p.nombre,
      descripcion: p.descripcion ?? "",
      url: p.url ?? "",
      tipo: p.tipo,
      solicitarFirma: p.solicitarFirma,
      campos: Array.isArray(p.campos) ? p.campos : [],
    });
    setPlantillaDialogOpen(true);
  };

  const plantillaFirmaObligatoria = esCarpetaFirmaObligatoria(plantillaForm.tipo || tipos[0]?.slug || "");

  const addCampo = () =>
    setPlantillaForm((f) => ({ ...f, campos: [...f.campos, { label: "", tipo: "texto" }] }));
  const updateCampo = (i: number, patch: Partial<CampoPlantilla>) =>
    setPlantillaForm((f) => ({ ...f, campos: f.campos.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));
  const removeCampo = (i: number) =>
    setPlantillaForm((f) => ({ ...f, campos: f.campos.filter((_, idx) => idx !== i) }));

  const guardarPlantilla = async () => {
    const nombre = plantillaForm.nombre.trim();
    if (!nombre) { toast({ title: "El nombre es obligatorio", variant: "destructive" }); return; }
    const tipo = plantillaForm.tipo || tipos[0]?.slug || "otro";
    const pedirFirma = plantillaFirmaObligatoria || plantillaForm.solicitarFirma;
    if (pedirFirma && !isSafeDocUrl(plantillaForm.url)) {
      toast({ title: "Añade la URL del documento para poder solicitar su firma", variant: "destructive" });
      return;
    }
    const campos = plantillaForm.campos.map((c) => ({ label: c.label.trim(), tipo: c.tipo })).filter((c) => c.label);
    setSavingPlantilla(true);
    try {
      const url = editandoPlantilla ? `/api/documentos/plantillas/${editandoPlantilla.id}` : "/api/documentos/plantillas";
      const res = await fetch(url, {
        method: editandoPlantilla ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...plantillaForm, nombre, tipo, campos, solicitarFirma: pedirFirma }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Error al guardar");
      toast({ title: editandoPlantilla ? "Plantilla actualizada" : "Plantilla creada", variant: "success" });
      setPlantillaDialogOpen(false);
      fetchData();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Error al guardar", variant: "destructive" });
    } finally {
      setSavingPlantilla(false);
    }
  };

  const borrarPlantilla = async (id: string) => {
    try {
      const res = await fetch(`/api/documentos/plantillas/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ title: "Plantilla eliminada", variant: "success" });
      fetchData();
    } catch {
      toast({ title: "Error al eliminar", variant: "destructive" });
    }
  };

  const abrirEnviar = (p: Plantilla) => {
    setEnviarPlantilla(p);
    setEnviarUserIds(new Set());
  };

  // Envía una plantilla a los empleados seleccionados (usada desde el diálogo
  // de envío y desde "Añadir documento → Desde plantilla").
  const confirmarEnvio = async (plantillaId: string, userIds: string[]) => {
    if (userIds.length === 0) { toast({ title: "Elige al menos un empleado", variant: "destructive" }); return false; }
    setEnviando(true);
    try {
      const res = await fetch(`/api/documentos/plantillas/${plantillaId}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Error al enviar");
      const data = await res.json().catch(() => ({}));
      toast({
        title: `Plantilla enviada a ${data.enviados ?? userIds.length} empleado(s)`,
        description: data.firmasSolicitadas ? `${data.firmasSolicitadas} con solicitud de firma` : undefined,
        variant: "success",
      });
      fetchData();
      return true;
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Error al enviar", variant: "destructive" });
      return false;
    } finally {
      setEnviando(false);
    }
  };

  const crearTipo = async () => {
    const nombre = nuevoTipo.trim();
    if (nombre.length < 2) return;
    try {
      const res = await fetch("/api/documentos/tipos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error);
      }
      setNuevoTipo("");
      toast({ title: "Tipo creado", variant: "success" });
      fetchData();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Error al crear", variant: "destructive" });
    }
  };

  const renombrarTipo = async (id: string, actual: string) => {
    const nombre = window.prompt("Nuevo nombre del tipo:", actual)?.trim();
    if (!nombre || nombre === actual) return;
    try {
      const res = await fetch(`/api/documentos/tipos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Tipo renombrado", variant: "success" });
      fetchData();
    } catch {
      toast({ title: "Error al renombrar", variant: "destructive" });
    }
  };

  const borrarTipo = async (id: string) => {
    try {
      const res = await fetch(`/api/documentos/tipos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ title: "Tipo eliminado", variant: "success" });
      fetchData();
    } catch {
      toast({ title: "Error al eliminar", variant: "destructive" });
    }
  };

  const docsCarpeta = carpeta ? documentos.filter((d) => d.tipo === carpeta) : [];

  // Carpeta seleccionada en el diálogo "Añadir documento": si es la de
  // contratos, la firma es obligatoria (checkbox marcado y bloqueado).
  const tipoDialogo = form.tipo || tipos[0]?.slug || "";
  const firmaObligatoriaDialogo = esCarpetaFirmaObligatoria(tipoDialogo);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Archivos</h1>
          <p className="text-slate-500 text-sm mt-1">
            {vista === "carpetas"
              ? `${documentos.length} documentos en ${carpetas.length} carpetas`
              : `${plantillas.length} plantilla${plantillas.length === 1 ? "" : "s"} de documentos`}
          </p>
        </div>
        <div className="flex gap-2">
          {vista === "carpetas" ? (
            <>
              <Button variant="outline" onClick={() => setGestionOpen(true)}>
                <Settings2 className="h-4 w-4 mr-2" /> Gestionar tipos
              </Button>
              <Button onClick={() => { setDocMode("nuevo"); setDocPlantillaId(""); setForm((f) => ({ ...f, tipo: carpeta ?? "" })); setSolicitarFirma(false); setDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" /> Añadir documento
              </Button>
            </>
          ) : (
            <Button onClick={abrirCrearPlantilla}>
              <Plus className="h-4 w-4 mr-2" /> Nueva plantilla
            </Button>
          )}
        </div>
      </div>

      {/* Pestañas: Carpetas / Plantillas */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button
          onClick={() => { setVista("carpetas"); }}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            vista === "carpetas" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
          )}
        >
          <Folder className="h-4 w-4" /> Carpetas
        </button>
        <button
          onClick={() => { setVista("plantillas"); setCarpeta(null); }}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            vista === "plantillas" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
          )}
        >
          <LayoutTemplate className="h-4 w-4" /> Plantillas
        </button>
      </div>

      {vista === "plantillas" ? (
        loading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
        ) : plantillas.length === 0 ? (
          <Card><CardContent className="py-12 text-center">
            <LayoutTemplate className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400">Aún no hay plantillas. Crea una para reutilizar los documentos que envías a todos tus empleados.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {plantillas.map((p) => (
              <div key={p.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border hover:shadow-sm transition-all">
                <div className="w-10 h-10 bg-[var(--primary-light)] rounded-lg flex items-center justify-center shrink-0">
                  <LayoutTemplate className="h-5 w-5 text-[var(--primary)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 truncate">{p.nombre}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {nombreCarpeta(p.tipo)}
                    {p.campos.length > 0 && ` · ${p.campos.length} campo${p.campos.length === 1 ? "" : "s"} a rellenar`}
                    {(p.solicitarFirma || esCarpetaFirmaObligatoria(p.tipo)) && " · firma"}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" onClick={() => abrirEnviar(p)}>
                    <Send className="h-3.5 w-3.5 mr-1.5" /> Enviar
                  </Button>
                  <button className="p-2 text-slate-400 hover:text-[var(--primary)] transition-colors" onClick={() => abrirEditarPlantilla(p)} title="Editar">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button className="p-2 text-slate-400 hover:text-red-500 transition-colors" onClick={() => borrarPlantilla(p.id)} title="Eliminar">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-44 bg-slate-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : carpeta === null ? (
        // ─── Vista de carpetas ───
        carpetas.length === 0 ? (
          <Card><CardContent className="py-12 text-center">
            <FolderOpen className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400">No hay tipos de carpeta. Crea uno en “Gestionar tipos”.</p>
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {carpetas.map((c) => (
              <button
                key={c.slug}
                onClick={() => setCarpeta(c.slug)}
                className="group rounded-2xl border border-slate-200 bg-white p-6 text-center transition-all hover:border-[var(--primary)] hover:shadow-md"
              >
                <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-[var(--primary-light)]">
                  <Folder className="h-10 w-10 text-[var(--primary)]" />
                </div>
                <p className="font-semibold text-slate-900">{c.nombre}</p>
                <p className="text-sm text-slate-400">{c.count} {c.count === 1 ? "elemento" : "elementos"}</p>
              </button>
            ))}
          </div>
        )
      ) : (
        // ─── Vista de una carpeta ───
        <div className="space-y-3">
          <button onClick={() => setCarpeta(null)} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-[var(--primary)]">
            <ArrowLeft className="h-4 w-4" /> Todas las carpetas
          </button>
          <h2 className="text-lg font-semibold text-slate-800">{nombreCarpeta(carpeta)}</h2>
          {docsCarpeta.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <FolderOpen className="h-10 w-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400">Esta carpeta está vacía</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {docsCarpeta.map((doc) => (
                <div key={doc.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border hover:shadow-sm transition-all">
                  <div className="w-10 h-10 bg-[var(--primary-light)] rounded-lg flex items-center justify-center shrink-0">
                    <FileText className="h-5 w-5 text-[var(--primary)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 truncate">{doc.nombre}</p>
                    {doc.descripcion && <p className="text-sm text-slate-500 truncate">{doc.descripcion}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">
                      {doc.user ? `${doc.user.nombre} ${doc.user.apellidos} · ` : "General · "}
                      {format(new Date(doc.createdAt), "d MMM yyyy", { locale: es })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isSafeDocUrl(doc.url) && (
                      <button type="button" onClick={() => openDocInNewTab(doc.url)} title="Abrir documento" className="p-2 text-slate-400 hover:text-[var(--primary)] transition-colors">
                        <Download className="h-4 w-4" />
                      </button>
                    )}
                    <button className="p-2 text-slate-400 hover:text-red-500 transition-colors" onClick={() => handleDelete(doc.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Añadir documento */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Añadir documento</DialogTitle></DialogHeader>

          {/* Modo: documento nuevo o adjuntar una plantilla */}
          <div className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              onClick={() => setDocMode("nuevo")}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                docMode === "nuevo" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
              )}
            >
              Documento nuevo
            </button>
            <button
              onClick={() => setDocMode("plantilla")}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                docMode === "plantilla" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
              )}
            >
              Desde plantilla
            </button>
          </div>

          {docMode === "plantilla" ? (
            <div className="space-y-4 py-2">
              {plantillas.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Aún no tienes plantillas. Créalas en la pestaña «Plantillas».
                </p>
              ) : (
                <>
                  <div>
                    <Label>Plantilla *</Label>
                    <Select value={docPlantillaId} onValueChange={setDocPlantillaId}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Elige una plantilla…" /></SelectTrigger>
                      <SelectContent>
                        {plantillas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Empleado destinatario *</Label>
                    <Select value={form.userId} onValueChange={(v) => setForm((f) => ({ ...f, userId: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Elige un empleado…" /></SelectTrigger>
                      <SelectContent>
                        {empleados.map((e) => (
                          <SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-slate-400">
                    Se creará el documento para el empleado a partir de la plantilla (con sus campos a rellenar y la solicitud de firma si la plantilla la incluye).
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div>
                <Label>Nombre *</Label>
                <Input className="mt-1" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Contrato indefinido 2024" />
              </div>
              <div>
                <Label>Carpeta / tipo</Label>
                <Select value={form.tipo || tipos[0]?.slug || ""} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                  <SelectContent>
                    {tipos.map((t) => <SelectItem key={t.slug} value={t.slug}>{t.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Empleado (opcional)</Label>
                <Select value={form.userId || GENERAL} onValueChange={(v) => setForm((f) => ({ ...f, userId: v === GENERAL ? "" : v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Documento general" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GENERAL}>Documento general</SelectItem>
                    {empleados.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>URL del archivo (opcional)</Label>
                <Input className="mt-1" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://..." />
              </div>
              <div>
                <Label>Descripción</Label>
                <Input className="mt-1" value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción breve" />
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[var(--primary)]"
                    checked={firmaObligatoriaDialogo || solicitarFirma}
                    disabled={firmaObligatoriaDialogo}
                    onChange={(e) => setSolicitarFirma(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium text-slate-800">Solicitar firma al empleado</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {firmaObligatoriaDialogo
                        ? "Los documentos de «Contratos laborales y anexos» requieren firma obligatoria. Elige el empleado y añade la URL del contrato."
                        : "El empleado recibirá un aviso para firmar el documento (nombre, DNI y firma manuscrita) antes de darlo por recibido."}
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            {docMode === "plantilla" ? (
              <Button
                disabled={enviando || !docPlantillaId || !form.userId}
                onClick={async () => {
                  const ok = await confirmarEnvio(docPlantillaId, form.userId ? [form.userId] : []);
                  if (ok) setDialogOpen(false);
                }}
              >
                {enviando ? "Enviando..." : "Adjuntar plantilla"}
              </Button>
            ) : (
              <Button onClick={handleCreate} disabled={saving}>{saving ? "Guardando..." : "Añadir"}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editor de plantillas */}
      <Dialog open={plantillaDialogOpen} onOpenChange={setPlantillaDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editandoPlantilla ? "Editar plantilla" : "Nueva plantilla"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nombre *</Label>
              <Input className="mt-1" value={plantillaForm.nombre} onChange={(e) => setPlantillaForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Contrato indefinido" />
            </div>
            <div>
              <Label>Carpeta / tipo</Label>
              <Select value={plantillaForm.tipo || tipos[0]?.slug || ""} onValueChange={(v) => setPlantillaForm((f) => ({ ...f, tipo: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                <SelectContent>
                  {tipos.map((t) => <SelectItem key={t.slug} value={t.slug}>{t.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>URL del archivo</Label>
              <Input className="mt-1" value={plantillaForm.url} onChange={(e) => setPlantillaForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://..." />
            </div>
            <div>
              <Label>Descripción</Label>
              <Input className="mt-1" value={plantillaForm.descripcion} onChange={(e) => setPlantillaForm((f) => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción breve" />
            </div>

            {/* Campos que el empleado tendrá que rellenar */}
            <div>
              <div className="flex items-center justify-between">
                <Label>Campos a rellenar</Label>
                <Button variant="outline" size="sm" onClick={addCampo}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Añadir campo
                </Button>
              </div>
              {plantillaForm.campos.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">
                  Marca los datos que el empleado tendrá que rellenar (p. ej. IBAN, talla de ropa, fecha de incorporación).
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {plantillaForm.campos.map((campo, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        className="flex-1"
                        value={campo.label}
                        onChange={(e) => updateCampo(i, { label: e.target.value })}
                        placeholder="Nombre del campo"
                      />
                      <Select value={campo.tipo} onValueChange={(v) => updateCampo(i, { tipo: v as CampoTipo })}>
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CAMPO_TIPOS.map((t) => <SelectItem key={t} value={t}>{CAMPO_TIPO_LABEL[t]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <button className="p-2 text-slate-400 hover:text-red-500 transition-colors shrink-0" onClick={() => removeCampo(i)} title="Quitar campo">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[var(--primary)]"
                  checked={plantillaFirmaObligatoria || plantillaForm.solicitarFirma}
                  disabled={plantillaFirmaObligatoria}
                  onChange={(e) => setPlantillaForm((f) => ({ ...f, solicitarFirma: e.target.checked }))}
                />
                <span>
                  <span className="font-medium text-slate-800">Solicitar firma al enviar</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {plantillaFirmaObligatoria
                      ? "Los documentos de «Contratos laborales y anexos» requieren firma obligatoria; necesitas un archivo adjunto."
                      : "Al enviar la plantilla, el empleado recibirá un aviso para firmar el documento."}
                  </span>
                </span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlantillaDialogOpen(false)}>Cancelar</Button>
            <Button onClick={guardarPlantilla} disabled={savingPlantilla}>{savingPlantilla ? "Guardando..." : editandoPlantilla ? "Actualizar" : "Crear plantilla"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enviar plantilla a empleados */}
      <Dialog open={enviarPlantilla !== null} onOpenChange={(o) => { if (!o) setEnviarPlantilla(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Enviar «{enviarPlantilla?.nombre}»</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-500">Elige los empleados que recibirán este documento.</p>
            <div className="max-h-64 overflow-y-auto rounded-md border border-input divide-y divide-slate-100">
              {empleados.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-400">No hay empleados.</p>
              ) : (
                empleados.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 accent-[var(--primary)] cursor-pointer shrink-0"
                      checked={enviarUserIds.has(e.id)}
                      onChange={() =>
                        setEnviarUserIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                          return next;
                        })
                      }
                    />
                    <span className="truncate">{e.nombre} {e.apellidos}</span>
                  </label>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnviarPlantilla(null)}>Cancelar</Button>
            <Button
              disabled={enviando || enviarUserIds.size === 0}
              onClick={async () => {
                if (!enviarPlantilla) return;
                const ok = await confirmarEnvio(enviarPlantilla.id, [...enviarUserIds]);
                if (ok) setEnviarPlantilla(null);
              }}
            >
              {enviando ? "Enviando..." : `Enviar (${enviarUserIds.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Gestionar tipos */}
      <Dialog open={gestionOpen} onOpenChange={setGestionOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Tipos de carpeta</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <Input
                value={nuevoTipo}
                onChange={(e) => setNuevoTipo(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") crearTipo(); }}
                placeholder="Nuevo tipo (ej. Contratos)"
              />
              <Button onClick={crearTipo} disabled={nuevoTipo.trim().length < 2}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
              {tipos.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-400">Aún no hay tipos.</p>
              ) : (
                tipos.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Folder className="h-4 w-4 text-[var(--primary)]" />
                      {t.nombre}
                      <span className="text-xs text-slate-400">
                        ({documentos.filter((d) => d.tipo === t.slug).length})
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <button onClick={() => renombrarTipo(t.id, t.nombre)} className="p-1 text-slate-400 hover:text-[var(--primary)]" title="Renombrar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => borrarTipo(t.id)} className="p-1 text-slate-400 hover:text-red-500" title="Eliminar">
                        <X className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-slate-400">
              Al eliminar un tipo, los documentos que tenía no se borran: siguen visibles en su carpeta.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setGestionOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
