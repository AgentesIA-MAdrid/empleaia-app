"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, X, ExternalLink } from "lucide-react";
import { openDocInNewTab } from "@/lib/documentos/url";
import type { CampoPlantilla } from "@/lib/documentos/campos";
import { cn } from "@/lib/utils";

/**
 * Editor visual para "marcar en el archivo dónde se van a colocar los datos que
 * introducirá el empleado". Sobre una vista a escala del documento (imagen o
 * páginas del PDF), el OWNER/MANAGER coloca cada campo con un clic y lo arrastra
 * a su sitio. Las posiciones se guardan normalizadas (0–1, origen arriba-izq.)
 * en `CampoPlantilla.posicion` y luego se estampan server-side al rellenar.
 *
 * Sin dependencias nuevas: para las imágenes usa su relación de aspecto natural;
 * para los PDF usa pdf-lib (ya presente) en el navegador para leer el número y
 * tamaño de páginas. No rasteriza el PDF (no hay visor embebido en el proyecto,
 * ver patrón `openDocInNewTab`): muestra cada hoja a escala con su número y un
 * botón para abrir el documento real como referencia.
 */

// Paleta para diferenciar los marcadores de cada campo.
const COLORES = ["#4f46e5", "#0891b2", "#db2777", "#ea580c", "#16a34a", "#9333ea", "#ca8a04", "#dc2626"];

interface PageSize {
  /** relación ancho/alto de la página (para el `aspect-ratio` del marco). */
  aspect: number;
}

type DocKind = "imagen" | "pdf" | "desconocido";

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function PlantillaPlacementEditor({
  url,
  campos,
  onCamposChange,
}: {
  url: string | null;
  campos: CampoPlantilla[];
  onCamposChange: (next: CampoPlantilla[]) => void;
}) {
  const [kind, setKind] = useState<DocKind>("desconocido");
  const [pages, setPages] = useState<PageSize[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<number | null>(null);
  const arrastreRef = useRef<{ index: number; frame: HTMLElement } | null>(null);

  // Analiza el documento adjunto para saber cuántas páginas hay y su tamaño.
  useEffect(() => {
    let cancelado = false;
    setError(null);
    if (!url) {
      setKind("desconocido");
      setPages([]);
      return;
    }
    if (url.startsWith("data:image/")) {
      setCargando(true);
      const img = new Image();
      img.onload = () => {
        if (cancelado) return;
        setKind("imagen");
        setPages([{ aspect: img.naturalWidth / img.naturalHeight || 0.7071 }]);
        setCargando(false);
      };
      img.onerror = () => {
        if (cancelado) return;
        setError("No se pudo leer la imagen adjunta.");
        setCargando(false);
      };
      img.src = url;
      return () => { cancelado = true; };
    }
    if (url.startsWith("data:application/pdf")) {
      setCargando(true);
      (async () => {
        try {
          const comma = url.indexOf(",");
          const bytes = Uint8Array.from(atob(url.slice(comma + 1)), (c) => c.charCodeAt(0));
          const { PDFDocument } = await import("pdf-lib");
          const pdf = await PDFDocument.load(bytes);
          if (cancelado) return;
          const sizes = pdf.getPages().map((p) => {
            const { width, height } = p.getSize();
            return { aspect: height > 0 ? width / height : 0.7071 };
          });
          setKind("pdf");
          setPages(sizes.length > 0 ? sizes : [{ aspect: 0.7071 }]);
        } catch {
          if (!cancelado) setError("No se pudo leer el PDF adjunto.");
        } finally {
          if (!cancelado) setCargando(false);
        }
      })();
      return () => { cancelado = true; };
    }
    // URL remota (https): no se puede analizar en el navegador; se coloca sobre
    // una hoja A4 de referencia (page 0).
    setKind("desconocido");
    setPages([{ aspect: 0.7071 }]);
    return () => { cancelado = true; };
  }, [url]);

  const setPosicion = (index: number, posicion: CampoPlantilla["posicion"] | undefined) => {
    onCamposChange(campos.map((c, i) => (i === index ? { ...c, posicion } : c)));
  };

  const colocarEnPagina = (page: number, e: React.MouseEvent<HTMLElement>) => {
    if (seleccion === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    setPosicion(seleccion, { page, x, y });
  };

  const onMarkerDown = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    e.stopPropagation();
    const frame = e.currentTarget.parentElement as HTMLElement | null;
    if (!frame) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    arrastreRef.current = { index, frame };
    setSeleccion(index);
  };
  const onMarkerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = arrastreRef.current;
    if (!d) return;
    const rect = d.frame.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    const actual = campos[d.index]?.posicion;
    setPosicion(d.index, { page: actual?.page ?? 0, x, y });
  };
  const onMarkerUp = () => { arrastreRef.current = null; };

  if (!url) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        Adjunta primero el archivo para poder marcar sobre él dónde se colocará cada dato.
      </p>
    );
  }

  const colocados = campos.filter((c) => c.posicion).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">
          {campos.length === 0
            ? "Añade campos arriba para poder colocarlos en el documento."
            : seleccion !== null
              ? `Haz clic en el documento para colocar «${campos[seleccion]?.label || "campo"}».`
              : `Elige un campo y haz clic en el documento donde debe ir su dato. (${colocados}/${campos.length} colocados)`}
        </p>
        <button
          type="button"
          onClick={() => openDocInNewTab(url)}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--primary)] hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Ver documento
        </button>
      </div>

      {/* Chips de campos: seleccionar cuál colocar / quitar su posición */}
      {campos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {campos.map((campo, i) => {
            const color = COLORES[i % COLORES.length];
            const activo = seleccion === i;
            return (
              <span
                key={i}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors",
                  activo ? "border-transparent text-white" : "border-[var(--border)] bg-[var(--card)] text-[var(--text-body)] hover:border-[var(--border-strong)]",
                )}
                style={activo ? { backgroundColor: color } : undefined}
              >
                <button type="button" className="inline-flex items-center gap-1" onClick={() => setSeleccion(activo ? null : i)}>
                  <MapPin className="h-3 w-3" style={activo ? undefined : { color }} />
                  {campo.label || `Campo ${i + 1}`}
                  {campo.posicion && <span className={cn("text-[10px]", activo ? "text-white/80" : "text-[var(--text-muted)]")}>· pág. {campo.posicion.page + 1}</span>}
                </button>
                {campo.posicion && (
                  <button type="button" title="Quitar posición" onClick={() => setPosicion(i, undefined)} className={cn(activo ? "text-white/80 hover:text-white" : "text-[var(--text-muted)] hover:text-[var(--danger)]")}>
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {error ? (
        <p className="text-xs text-[var(--warning-text)]">{error}</p>
      ) : cargando ? (
        <div className="h-40 animate-pulse rounded-lg bg-[var(--muted)]" />
      ) : (
        <div className="space-y-3">
          {pages.map((pageSize, pageIndex) => (
            <div key={pageIndex} className="relative">
              {pages.length > 1 && <p className="mb-1 text-[11px] text-[var(--text-muted)]">Página {pageIndex + 1}</p>}
              <div
                onClick={(e) => colocarEnPagina(pageIndex, e)}
                className={cn(
                  "relative mx-auto w-full max-w-sm overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--muted)] shadow-sm",
                  seleccion !== null ? "cursor-crosshair" : "cursor-default",
                )}
                style={{ aspectRatio: String(pageSize.aspect || 0.7071) }}
              >
                {kind === "imagen" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="Documento" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
                ) : (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-[11px] text-[var(--text-muted)]">
                    {kind === "pdf" ? "Vista a escala de la hoja (abre el documento para ver su contenido)" : "Hoja de referencia"}
                  </div>
                )}

                {campos.map((campo, i) => {
                  if (!campo.posicion || campo.posicion.page !== pageIndex) return null;
                  const color = COLORES[i % COLORES.length];
                  return (
                    <button
                      key={i}
                      type="button"
                      onPointerDown={(e) => onMarkerDown(e, i)}
                      onPointerMove={onMarkerMove}
                      onPointerUp={onMarkerUp}
                      onClick={(e) => e.stopPropagation()}
                      title={campo.label}
                      className="absolute z-10 flex max-w-[70%] -translate-x-1/2 -translate-y-1/2 touch-none items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow ring-2 ring-white"
                      style={{ left: `${campo.posicion.x * 100}%`, top: `${campo.posicion.y * 100}%`, backgroundColor: color }}
                    >
                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{campo.label || `Campo ${i + 1}`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
