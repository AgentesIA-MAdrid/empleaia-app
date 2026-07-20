"use client";

import { Download } from "lucide-react";
import { downloadDoc } from "@/lib/documentos/url";

/**
 * Descarga la copia del documento con la firma manuscrita estampada en el
 * margen de cada página. Se guarda como data URL de PDF; `downloadDoc` lo
 * convierte a blob para descargar de forma fiable.
 */
export function DescargarFirmadoButton({ url, nombre }: { url: string; nombre: string }) {
  return (
    <button
      type="button"
      onClick={() => downloadDoc(url, `${nombre} (firmado).pdf`)}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-800 hover:underline"
    >
      <Download className="h-4 w-4" />
      Descargar documento firmado
    </button>
  );
}
