"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { FolderOpen, FileText, Download, Upload, Loader2, PencilLine } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isSafeDocUrl, openDocInNewTab } from "@/lib/documentos/url";
import { normalizarCampos, type CampoPlantilla } from "@/lib/documentos/campos";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Documento { id: string; nombre: string; descripcion?: string; url?: string; tipo: string; createdAt: string; subidoPor?: { nombre: string; apellidos: string } | null; campos?: unknown; camposRespuestas?: unknown; }

// ¿El documento tiene campos que el empleado debe rellenar?
function camposDe(doc: Documento): CampoPlantilla[] {
  return normalizarCampos(doc.campos);
}
function respuestasDe(doc: Documento): string[] {
  return Array.isArray(doc.camposRespuestas) ? doc.camposRespuestas.map((r) => (typeof r === "string" ? r : "")) : [];
}
function tieneRespuestas(doc: Documento): boolean {
  return respuestasDe(doc).some((r) => r.trim() !== "");
}
const TIPO_COLOR: Record<string, string> = {
  contrato: "bg-sky-100 text-sky-700", nomina: "bg-emerald-100 text-emerald-700",
  certificado: "bg-purple-100 text-purple-700", formacion: "bg-amber-100 text-amber-700", otro: "bg-slate-100 text-slate-600",
};
const MAX_MB = 5;

export default function EmpleadoDocumentosPage() {
  const { toast } = useToast();
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Rellenar campos de un documento que llegó desde una plantilla.
  const [rellenando, setRellenando] = useState<Documento | null>(null);
  const [respuestas, setRespuestas] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => {
    fetch("/api/documentos").then((r) => r.json()).then((d) => { setDocumentos(d.documentos || []); setLoading(false); });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  // Adjuntar un documento propio: se sube como data URL a /api/documentos
  // (el backend fuerza userId = el propio empleado).
  const adjuntar = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast({ variant: "destructive", title: `El archivo supera ${MAX_MB} MB` });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setSubiendo(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const r = await fetch("/api/documentos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: file.name, tipo: "otro", url: reader.result }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Error");
        toast({ variant: "success", title: "Documento adjuntado" });
        cargar();
      } catch (e) {
        toast({ variant: "destructive", title: e instanceof Error ? e.message : "No se pudo subir" });
      } finally {
        setSubiendo(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  const abrirRellenar = (doc: Documento) => {
    const campos = camposDe(doc);
    const prev = respuestasDe(doc);
    setRespuestas(campos.map((_, i) => prev[i] ?? ""));
    setRellenando(doc);
  };

  const guardarRespuestas = async () => {
    if (!rellenando) return;
    setGuardando(true);
    try {
      const r = await fetch(`/api/documentos/${rellenando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respuestas }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Error");
      toast({ variant: "success", title: "Datos guardados" });
      setRellenando(null);
      cargar();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "No se pudo guardar" });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-slate-900">Mis Documentos</h1><p className="text-slate-500 text-sm mt-1">{documentos.length} documentos</p></div>
        <div>
          <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => adjuntar(e.target.files?.[0])} />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={subiendo}>
            {subiendo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />} Adjuntar documento
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : documentos.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><FolderOpen className="h-10 w-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-400">No tienes documentos disponibles</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {documentos.map((doc) => {
            const campos = camposDe(doc);
            const relleno = campos.length > 0 && tieneRespuestas(doc);
            return (
            <div key={doc.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border hover:shadow-sm transition-all">
              <div className="w-10 h-10 bg-[var(--primary-light)] rounded-lg flex items-center justify-center shrink-0"><FileText className="h-5 w-5 text-[var(--primary)]" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-slate-900 truncate">{doc.nombre}</p>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium capitalize", TIPO_COLOR[doc.tipo] ?? "bg-slate-100")}>{doc.tipo}</span>
                  {campos.length > 0 && (
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", relleno ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                      {relleno ? "Rellenado" : `${campos.length} campo${campos.length === 1 ? "" : "s"} por rellenar`}
                    </span>
                  )}
                </div>
                {doc.descripcion && <p className="text-sm text-slate-500 truncate">{doc.descripcion}</p>}
                <p className="text-xs text-slate-400 mt-0.5">{format(new Date(doc.createdAt), "d MMM yyyy", { locale: es })}</p>
              </div>
              {campos.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => abrirRellenar(doc)}>
                  <PencilLine className="h-4 w-4 mr-1.5" /> {relleno ? "Editar" : "Rellenar"}
                </Button>
              )}
              {isSafeDocUrl(doc.url) && <button type="button" onClick={() => openDocInNewTab(doc.url)} title="Abrir documento" className="p-2 text-slate-400 hover:text-[var(--primary)]"><Download className="h-4 w-4" /></button>}
            </div>
            );
          })}
        </div>
      )}

      {/* Rellenar los campos del documento (llegó desde una plantilla) */}
      <Dialog open={rellenando !== null} onOpenChange={(o) => { if (!o) setRellenando(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Rellenar «{rellenando?.nombre}»</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {rellenando && camposDe(rellenando).map((campo, i) => (
              <div key={i}>
                <Label>{campo.label}</Label>
                <Input
                  className="mt-1"
                  type={campo.tipo === "fecha" ? "date" : campo.tipo === "numero" ? "number" : "text"}
                  value={respuestas[i] ?? ""}
                  onChange={(e) => setRespuestas((prev) => prev.map((r, idx) => (idx === i ? e.target.value : r)))}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRellenando(null)}>Cancelar</Button>
            <Button onClick={guardarRespuestas} disabled={guardando}>{guardando ? "Guardando..." : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
