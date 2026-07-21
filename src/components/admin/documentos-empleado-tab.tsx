"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Upload, Download, Trash2, PenLine, Loader2, CheckCircle2, Clock, Award, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { isSafeDocUrl, downloadDoc } from "@/lib/documentos/url";
import { esCarpetaFirmaObligatoria } from "@/lib/documentos/categorias";
import { descargarCertificadoFirma } from "@/lib/documentos/certificado";

interface DocRow {
  id: string;
  nombre: string;
  descripcion: string | null;
  url: string | null;
  tipo: string;
  userId: string | null;
  createdAt: string;
  documentoRellenoUrl?: string | null;
  subidoPor?: { nombre: string; apellidos: string } | null;
  solicitudesFirma?: { id: string; estado: string; destinatarioId: string }[];
  firmas?: { id: string; userId: string }[];
}
interface TipoDoc { id: string; nombre: string; slug: string }

const MAX_MB = 5;

/**
 * Pestaña "Documentos" dentro de la ficha de un empleado (panel admin).
 * Reutiliza /api/documentos (filtrado por ?userId=) y /api/solicitudes-firma.
 * OWNER: enviar, solicitar firma, borrar. MANAGER: enviar. Solo lectura si no.
 */
export function DocumentosEmpleadoTab({
  empleadoId,
  empleadoNombre,
  viewerRol,
}: {
  empleadoId: string;
  empleadoNombre: string;
  viewerRol: string;
}) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [tipos, setTipos] = useState<TipoDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [firmandoId, setFirmandoId] = useState<string | null>(null);
  const [certId, setCertId] = useState<string | null>(null);
  const [firmadoId, setFirmadoId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<{ nombre: string; tipo: string; descripcion: string; dataUrl: string | null }>({
    nombre: "", tipo: "otro", descripcion: "", dataUrl: null,
  });
  const [solicitarFirmaAlEnviar, setSolicitarFirmaAlEnviar] = useState(false);

  const puedeEnviar = viewerRol === "OWNER" || viewerRol === "MANAGER";
  const puedeFirmarYBorrar = viewerRol === "OWNER";

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [rd, rt] = await Promise.all([
        fetch(`/api/documentos?userId=${empleadoId}`),
        fetch("/api/documentos/tipos"),
      ]);
      if (rd.ok) setDocs((await rd.json()).documentos ?? []);
      if (rt.ok) setTipos((await rt.json()).tipos ?? []);
    } finally {
      setLoading(false);
    }
  }, [empleadoId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const onFile = (file: File | undefined) => {
    if (!file) { setForm((f) => ({ ...f, dataUrl: null })); return; }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast({ variant: "destructive", title: `El archivo supera ${MAX_MB} MB` });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, dataUrl: reader.result as string, nombre: f.nombre || file.name }));
    reader.readAsDataURL(file);
  };

  const enviar = async () => {
    if (!form.nombre.trim()) { toast({ variant: "destructive", title: "Pon un nombre al documento" }); return; }
    // La carpeta de contratos exige firma obligatoria; en el resto es opcional.
    const firmaOblig = esCarpetaFirmaObligatoria(form.tipo);
    const pedirFirma = firmaOblig || solicitarFirmaAlEnviar;
    if (pedirFirma && !isSafeDocUrl(form.dataUrl)) {
      toast({
        variant: "destructive",
        title: firmaOblig
          ? "Adjunta el archivo del contrato para que el empleado pueda firmarlo"
          : "Adjunta el archivo del documento para poder solicitar su firma",
      });
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch("/api/documentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre.trim(),
          descripcion: form.descripcion.trim() || null,
          tipo: form.tipo,
          url: form.dataUrl,
          userId: empleadoId,
          solicitarFirma: pedirFirma,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Error");
      const data = await r.json().catch(() => ({}));
      toast({
        variant: "success",
        title: data.firmaSolicitada ? "Documento enviado y firma solicitada" : "Documento enviado al empleado",
      });
      setDialogOpen(false);
      setForm({ nombre: "", tipo: "otro", descripcion: "", dataUrl: null });
      setSolicitarFirmaAlEnviar(false);
      if (fileRef.current) fileRef.current.value = "";
      void cargar();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "No se pudo enviar" });
    } finally {
      setEnviando(false);
    }
  };

  const solicitarFirma = async (doc: DocRow) => {
    setFirmandoId(doc.id);
    try {
      const r = await fetch("/api/solicitudes-firma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentoId: doc.id, destinatarioId: empleadoId }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Error");
      toast({ variant: "success", title: "Firma solicitada", description: `${empleadoNombre} recibirá un aviso para firmar.` });
      void cargar();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "No se pudo solicitar" });
    } finally {
      setFirmandoId(null);
    }
  };

  const borrar = async (doc: DocRow) => {
    if (!window.confirm(`¿Eliminar "${doc.nombre}"?`)) return;
    const r = await fetch(`/api/documentos/${doc.id}`, { method: "DELETE" });
    if (r.ok) { toast({ variant: "success", title: "Documento eliminado" }); void cargar(); }
    else toast({ variant: "destructive", title: "No se pudo eliminar" });
  };

  // Descarga el certificado/acta probatorio de la firma. Los datos (fecha,
  // hash, IP, navegador) vienen de /api/firmas; el PDF se genera en cliente.
  const descargarCertificado = async (doc: DocRow) => {
    setCertId(doc.id);
    try {
      const r = await fetch(`/api/firmas?documentoId=${doc.id}`);
      const firma = r.ok ? ((await r.json()).firmas ?? [])[0] : null;
      if (!firma) {
        toast({ variant: "destructive", title: "No se encontró la firma de este documento" });
        return;
      }
      await descargarCertificadoFirma({
        documentoNombre: doc.nombre,
        firmanteNombre:
          firma.firmanteNombre ||
          `${firma.user?.nombre ?? ""} ${firma.user?.apellidos ?? ""}`.trim() ||
          empleadoNombre,
        firmadoEn: firma.firmadoEn,
        documentHash: firma.documentHash,
        ip: firma.ip,
        userAgent: firma.userAgent,
        firmanteDni: firma.firmanteDni,
        firmaImagen: firma.firmaImagen,
      });
    } catch {
      toast({ variant: "destructive", title: "No se pudo generar el certificado" });
    } finally {
      setCertId(null);
    }
  };

  // Descarga la copia del documento con la firma estampada en cada página.
  const descargarFirmado = async (doc: DocRow) => {
    setFirmadoId(doc.id);
    try {
      const r = await fetch(`/api/firmas?documentoId=${doc.id}`);
      const firma = r.ok ? ((await r.json()).firmas ?? [])[0] : null;
      if (!firma?.documentoFirmadoUrl) {
        toast({ variant: "destructive", title: "Este documento no tiene copia firmada" });
        return;
      }
      downloadDoc(firma.documentoFirmadoUrl, `${doc.nombre} (firmado).pdf`);
    } catch {
      toast({ variant: "destructive", title: "No se pudo descargar el documento firmado" });
    } finally {
      setFirmadoId(null);
    }
  };

  const estadoFirma = (doc: DocRow) => {
    if (doc.firmas && doc.firmas.length > 0) return { txt: "Firmado", cls: "text-emerald-600", icon: CheckCircle2 };
    const sol = doc.solicitudesFirma?.find((s) => s.destinatarioId === empleadoId);
    if (sol?.estado === "pendiente") return { txt: "Firma pendiente", cls: "text-amber-600", icon: Clock };
    return null;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Documentos de {empleadoNombre} (nóminas, contratos, adjuntos…)</p>
        {puedeEnviar && (
          <Button size="sm" onClick={() => { setSolicitarFirmaAlEnviar(false); setDialogOpen(true); }}>
            <Upload className="mr-1.5 h-4 w-4" /> Enviar documento
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : docs.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">Sin documentos todavía.</p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
          {docs.map((d) => {
            const ef = estadoFirma(d);
            return (
              <div key={d.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-800">{d.nombre}</div>
                  <div className="text-xs text-slate-400">
                    {new Date(d.createdAt).toLocaleDateString("es-ES")}
                    {d.subidoPor ? ` · ${d.subidoPor.nombre} ${d.subidoPor.apellidos}` : ""}
                    {ef && <span className={`ml-1 ${ef.cls}`}>· {ef.txt}</span>}
                  </div>
                </div>
                {isSafeDocUrl(d.url) && (
                  <button type="button" onClick={() => downloadDoc(d.url, d.nombre)} className="text-slate-400 hover:text-[var(--primary)]" title="Descargar documento">
                    <Download className="h-4 w-4" />
                  </button>
                )}
                {isSafeDocUrl(d.documentoRellenoUrl) && (
                  <button type="button" onClick={() => downloadDoc(d.documentoRellenoUrl, `${d.nombre} (con datos).pdf`)} className="text-slate-400 hover:text-emerald-600" title="Descargar con los datos rellenados">
                    <FileText className="h-4 w-4" />
                  </button>
                )}
                {ef?.txt === "Firmado" && (
                  <button type="button" onClick={() => void descargarFirmado(d)} disabled={firmadoId === d.id} className="text-slate-400 hover:text-emerald-600 disabled:opacity-50" title="Descargar documento firmado">
                    {firmadoId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}
                  </button>
                )}
                {ef?.txt === "Firmado" && (
                  <button type="button" onClick={() => void descargarCertificado(d)} disabled={certId === d.id} className="text-slate-400 hover:text-[var(--primary)] disabled:opacity-50" title="Descargar certificado de firma">
                    {certId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />}
                  </button>
                )}
                {puedeFirmarYBorrar && isSafeDocUrl(d.url) && !ef && (
                  <button type="button" onClick={() => void solicitarFirma(d)} disabled={firmandoId === d.id} className="text-slate-400 hover:text-[var(--primary)] disabled:opacity-50" title="Solicitar firma">
                    {firmandoId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
                  </button>
                )}
                {puedeFirmarYBorrar && (
                  <button type="button" onClick={() => void borrar(d)} className="text-slate-400 hover:text-red-500" title="Eliminar">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Enviar documento a {empleadoNombre}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Archivo (PDF/imagen, máx {MAX_MB} MB)</Label>
              <input ref={fileRef} type="file" accept=".pdf,image/*"
                onChange={(e) => onFile(e.target.files?.[0])}
                className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm" />
            </div>
            <div>
              <Label htmlFor="doc-nombre">Nombre</Label>
              <Input id="doc-nombre" className="mt-1" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Nómina junio 2026" />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="otro">Otro</SelectItem>
                  {tipos.map((t) => <SelectItem key={t.id} value={t.slug}>{t.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="doc-desc">Descripción (opcional)</Label>
              <Input id="doc-desc" className="mt-1" value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} />
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[var(--primary)]"
                  checked={esCarpetaFirmaObligatoria(form.tipo) || solicitarFirmaAlEnviar}
                  disabled={esCarpetaFirmaObligatoria(form.tipo)}
                  onChange={(e) => setSolicitarFirmaAlEnviar(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-800">Solicitar firma al enviar</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {esCarpetaFirmaObligatoria(form.tipo)
                      ? "Los documentos de «Contratos laborales y anexos» requieren firma obligatoria: se pedirá a la persona su nombre, DNI y firma manuscrita."
                      : `${empleadoNombre} recibirá un aviso para leer y firmar el documento (nombre, DNI y firma manuscrita).`}
                  </span>
                </span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={enviando}>Cancelar</Button>
            <Button onClick={enviar} disabled={enviando}>
              {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
