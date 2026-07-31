/**
 * Descarga de una tabla como CSV desde el navegador.
 *
 * Vive aquí (módulo puro, sin Prisma ni React) porque lo usan varias pantallas
 * cliente del módulo de cierre de turno: el informe de ventas y el seguimiento
 * de objetivos. Mismo motivo que `horas-centro-csv.ts`: una sola
 * implementación para que los CSV no se separen con el tiempo.
 *
 * Formato pensado para abrirse en Excel en español: BOM UTF-8, separador punto
 * y coma y coma decimal.
 */

export type CeldaCSV = string | number | null;

/** El texto del CSV, por si hace falta sin descargarlo (tests incluidos). */
export function generarCSV(cabeceras: string[], filas: CeldaCSV[][]): string {
  const celda = (v: CeldaCSV) => {
    if (v === null) return "";
    if (typeof v === "number") return String(v).replace(".", ",");
    return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const texto = [cabeceras.join(";"), ...filas.map((f) => f.map(celda).join(";"))].join("\n");
  // BOM para que Excel respete las tildes.
  return `﻿${texto}`;
}

/** Dispara la descarga del CSV en el navegador. */
export function descargarCSV(nombre: string, cabeceras: string[], filas: CeldaCSV[][]): void {
  const blob = new Blob([generarCSV(cabeceras, filas)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}
