"use client";

import { useEffect, useState } from "react";
import { FolderOpen, FileText, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { isSafeDocUrl, openDocInNewTab } from "@/lib/documentos/url";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Documento { id: string; nombre: string; descripcion?: string; url?: string; tipo: string; user?: { nombre: string; apellidos: string }; createdAt: string; }

const TIPO_COLOR: Record<string, string> = {
  contrato: "bg-sky-100 text-sky-700", nomina: "bg-emerald-100 text-emerald-700",
  certificado: "bg-purple-100 text-purple-700", formacion: "bg-amber-100 text-amber-700", otro: "bg-slate-100 text-slate-600",
};

export default function ManagerDocumentosPage() {
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/documentos").then((r) => r.json()).then((d) => { setDocumentos(d.documentos || []); setLoading(false); });
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">Documentos</h1><p className="text-slate-500 text-sm mt-1">Documentos del equipo</p></div>
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : documentos.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><FolderOpen className="h-10 w-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-400">No hay documentos</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {documentos.map((doc) => (
            <div key={doc.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border hover:shadow-sm transition-all">
              <div className="w-10 h-10 bg-[var(--primary-light)] rounded-lg flex items-center justify-center shrink-0"><FileText className="h-5 w-5 text-[var(--primary)]" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-slate-900 truncate">{doc.nombre}</p>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium capitalize", TIPO_COLOR[doc.tipo] ?? "bg-slate-100 text-slate-600")}>{doc.tipo}</span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{doc.user ? `${doc.user.nombre} ${doc.user.apellidos} · ` : "General · "}{format(new Date(doc.createdAt), "d MMM yyyy", { locale: es })}</p>
              </div>
              {isSafeDocUrl(doc.url) && <button type="button" onClick={() => openDocInNewTab(doc.url)} title="Abrir documento" className="p-2 text-slate-400 hover:text-[var(--primary)]"><Download className="h-4 w-4" /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
