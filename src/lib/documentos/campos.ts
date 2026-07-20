/**
 * Campos rellenables de una plantilla de documento — módulo puro (sin
 * dependencias de servidor) para poder usarlo tanto en el backend como en la UI.
 */

/** Tipos de campo que el empleado puede tener que rellenar en una plantilla. */
export const CAMPO_TIPOS = ["texto", "fecha", "numero", "firma"] as const;
export type CampoTipo = (typeof CAMPO_TIPOS)[number];

export interface CampoPlantilla {
  label: string;
  tipo: CampoTipo;
}

/** Etiqueta legible para cada tipo de campo (UI). */
export const CAMPO_TIPO_LABEL: Record<CampoTipo, string> = {
  texto: "Texto",
  fecha: "Fecha",
  numero: "Número",
  firma: "Firma",
};

/**
 * Normaliza y valida el array de campos que llega del cliente o de BD (Json).
 * Descarta entradas sin `label`; recorta a un máximo razonable para no dejar
 * crecer sin límite el JSON del documento.
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
    campos.push({ label: label.slice(0, 120), tipo });
    if (campos.length >= 50) break;
  }
  return campos;
}
