/**
 * Campos rellenables de una plantilla de documento — módulo puro (sin
 * dependencias de servidor) para poder usarlo tanto en el backend como en la UI.
 */

/** Tipos de campo que el empleado puede tener que rellenar en una plantilla. */
export const CAMPO_TIPOS = ["texto", "fecha", "numero", "firma"] as const;
export type CampoTipo = (typeof CAMPO_TIPOS)[number];

/**
 * Posición del campo dentro del documento (dónde se "coloca" el dato que el
 * empleado rellena). Coordenadas NORMALIZADAS 0–1 con origen en la esquina
 * superior izquierda de la página (x → derecha, y → abajo) para ser
 * independientes del tamaño real de la hoja. `page` es el índice de página
 * (0 = primera). Un campo sin posición se comporta como hasta ahora: se
 * recoge el dato pero no se estampa en el archivo.
 */
export interface CampoPosicion {
  page: number;
  x: number;
  y: number;
}

export interface CampoPlantilla {
  label: string;
  tipo: CampoTipo;
  /** Dónde se estampará el dato en el documento (opcional). */
  posicion?: CampoPosicion;
}

/** Etiqueta legible para cada tipo de campo (UI). */
export const CAMPO_TIPO_LABEL: Record<CampoTipo, string> = {
  texto: "Texto",
  fecha: "Fecha",
  numero: "Número",
  firma: "Firma",
};

/** Recorta un número al rango [0, 1]; devuelve null si no es un número finito. */
function clamp01(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/** Normaliza la posición de un campo, o undefined si no es válida. */
export function normalizarPosicion(input: unknown): CampoPosicion | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as { page?: unknown; x?: unknown; y?: unknown };
  const x = clamp01(obj.x);
  const y = clamp01(obj.y);
  if (x === null || y === null) return undefined;
  const pageRaw = typeof obj.page === "number" ? obj.page : Number(obj.page);
  const page = Number.isFinite(pageRaw) ? Math.max(0, Math.min(200, Math.trunc(pageRaw))) : 0;
  return { page, x, y };
}

/**
 * Normaliza y valida el array de campos que llega del cliente o de BD (Json).
 * Descarta entradas sin `label`; recorta a un máximo razonable para no dejar
 * crecer sin límite el JSON del documento. Preserva la posición si es válida.
 */
export function normalizarCampos(input: unknown): CampoPlantilla[] {
  if (!Array.isArray(input)) return [];
  const campos: CampoPlantilla[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const label = typeof (item as { label?: unknown }).label === "string"
      ? (item as { label: string }).label.trim()
      : "";
    if (!label) continue;
    const tipoRaw = (item as { tipo?: unknown }).tipo;
    const tipo: CampoTipo = CAMPO_TIPOS.includes(tipoRaw as CampoTipo)
      ? (tipoRaw as CampoTipo)
      : "texto";
    const campo: CampoPlantilla = { label: label.slice(0, 120), tipo };
    const posicion = normalizarPosicion((item as { posicion?: unknown }).posicion);
    if (posicion) campo.posicion = posicion;
    campos.push(campo);
    if (campos.length >= 50) break;
  }
  return campos;
}
