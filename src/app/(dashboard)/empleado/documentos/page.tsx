"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { FolderOpen, FileText, Download, Upload, Loader2, PencilLine, FileCheck, FileSignature } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isSafeDocUrl, openDocInNewTab, downloadDoc } from "@/lib/documentos/url";
import { descargarFirmadoConCertificado } from "@/lib/documentos/certificado";
import { normalizarCampos, type CampoPlantilla } from "@/lib/documentos/campos";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Documento { id: string; nombre: string; descripcion?: string; url?: string; tipo: string; createdAt: string; subidoPor?: { nombre: string; apellidos: string } | null; campos?: unknown; camposRespuestas?: unknown; documentoRellenoUrl?: string | null; /** Ya lo he firmado y hay copia sellada: es la única que se puede descargar. */ firmadoPorMi?: boolean; }

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
  contrato: "bg-sky-100 text-sky-700", nomina: "bg-[var(--success-bg)] text-[var(--success-text)]",
  certificado: "bg-purple-100 text-purple-700", formacion: "bg-[var(--warning-bg)] text-[var(--warning-text)]", otro: "bg-[var(--muted)] text-[var(--text-body)]",
};
const MAX_MB = 5;

export default function EmpleadoDocumentosPage() {
  const { toast } = useToast();
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [descargandoId, setDescargandoId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * Descarga su copia FIRMADA: el documento sellado seguido del acta probatoria
   * (fecha, hash, IP, navegador), en un único PDF. Es la misma descarga que ve
   * administración, y la única que se le ofrece de un documento que ya ha
   * firmado: la versión preliminar deja de estar a mano para que no se guarde
   * ni se reenvíe la que no vale (ticket 6b0f74d2).
   */
  const descargarFirmado = async (doc: Documento) => {
    setDescargandoId(doc.id);
    try {
      const r = await fetch(`/api/firmas?documentoId=${doc.id}`);
      // El endpoint ya acota al propio usuario cuando quien pregunta no es
      // gestión, así que la primera firma es la suya.
      const firma = r.ok ? ((await r.json()).firmas ?? [])[0] : null;
      if (!firma?.documentoFirmadoUrl) {
        toast({ variant: "destructive", title: "No se encontró tu copia firmada de este documento" });
        return;
      }
      await descargarFirmadoConCertificado(firma.documentoFirmadoUrl, {
        documentoNombre: doc.nombre,
        firmanteNombre:
          firma.firmanteNombre ||
          `${firma.user?.nombre ?? ""} ${firma.user?.apellidos ?? ""}`.trim(),
        firmadoEn: firma.firmadoEn,
        documentHash: firma.documentHash,
        ip: firma.ip,
        userAgent: firma.userAgent,
        firmanteDni: firma.firmanteDni,
        firmaImagen: firma.firmaImagen,
      });
    } catch {
      toast({ variant: "destructive", title: "No se pudo descargar tu documento firmado" });
    } finally {
      setDescargandoId(null);
    }
  };

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
        <div><h1 className="text-2xl font-bold text-[var(--text-dark)]">Mis Documentos</h1><p className="text-[var(--text-muted)] text-sm mt-1">{documentos.length} documentos</p></div>
        <div>
          <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => adjuntar(e.target.files?.[0])} />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={subiendo}>
            {subiendo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />} Adjuntar documento
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 bg-[var(--muted)] rounded-xl animate-pulse" />)}</div>
      ) : documentos.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><FolderOpen className="h-10 w-10 text-slate-200 mx-auto mb-3" /><p className="text-[var(--text-muted)]">No tienes documentos disponibles</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {documentos.map((doc) => {
            const campos = camposDe(doc);
            const relleno = campos.length > 0 && tieneRespuestas(doc);
            return (
            <div key={doc.id} className="flex items-center gap-4 p-4 bg-[var(--card)] rounded-xl border hover:shadow-sm transition-all">
              <div className="w-10 h-10 bg-[var(--primary-light)] rounded-lg flex items-center justify-center shrink-0"><FileText className="h-5 w-5 text-[var(--primary)]" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-[var(--text-dark)] truncate">{doc.nombre}</p>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium capitalize", TIPO_COLOR[doc.tipo] ?? "bg-[var(--muted)]")}>{doc.tipo}</span>
                  {campos.length > 0 && (
                    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", relleno ? "bg-[var(--success-bg)] text-[var(--success-text)]" : "bg-[var(--warning-bg)] text-[var(--warning-text)]")}>
                      {relleno ? "Rellenado" : `${campos.length} campo${campos.length === 1 ? "" : "s"} por rellenar`}
                    </span>
                  )}
                </div>
                {doc.descripcion && <p className="text-sm text-[var(--text-muted)] truncate">{doc.descripcion}</p>}
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{format(new Date(doc.createdAt), "d MMM yyyy", { locale: es })}</p>
              </div>
              {campos.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => abrirRellenar(doc)}>
                  <PencilLine className="h-4 w-4 mr-1.5" /> {relleno ? "Editar" : "Rellenar"}
                </Button>
              )}
              {/* Ya firmado: la copia sellada es la única que se descarga. La
                  preliminar se retira a propósito —tener las dos a mano invita a
                  guardar y reenviar la que no vale (ticket 6b0f74d2). */}
              {doc.firmadoPorMi ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={descargandoId === doc.id}
                  onClick={() => void descargarFirmado(doc)}
                >
                  {descargandoId === doc.id ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <FileSignature className="h-4 w-4 mr-1.5" />
                  )}
                  Descargar firmado
                </Button>
              ) : (
                <>
                  {isSafeDocUrl(doc.documentoRellenoUrl) && (
                    <button type="button" onClick={() => downloadDoc(doc.documentoRellenoUrl, `${doc.nombre} (con mis datos).pdf`)} title="Descargar con mis datos" className="p-2 text-[var(--text-muted)] hover:text-[var(--success-text)]"><FileCheck className="h-4 w-4" /></button>
                  )}
                  {isSafeDocUrl(doc.url) && <button type="button" onClick={() => openDocInNewTab(doc.url)} title="Abrir documento" className="p-2 text-[var(--text-muted)] hover:text-[var(--primary)]"><Download className="h-4 w-4" /></button>}
                </>
              )}
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
