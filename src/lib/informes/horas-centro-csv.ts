/**
 * CSV del informe "horas por empleado y centro".
 *
 * Vive aquí (módulo puro, sin Prisma ni React) porque lo usan dos pantallas
 * cliente: `/admin/informes` y el cuadrante de `/admin/turnos`. Mantener una
 * sola implementación evita que los dos CSV se separen con el tiempo.
 *
 * Formato pensado para abrirse en Excel en español: BOM UTF-8, separador
 * coma, decimales con coma y campos entre comillas.
 *
 * Las horas van ENTRECOMILLADAS a propósito: con separador coma y decimal
 * coma, un `12,5` suelto parte la fila en dos columnas (Excel leía "12" y
 * "5"). Entre comillas queda una sola celda numérica.
 *
 * Además de las horas del centro, cada fila lleva el total del empleado, sus
 * horas de contrato en el periodo y la diferencia (positiva = horas extra).
 * Contrato y diferencia son de la PERSONA, no de la sede: se repiten iguales
 * en todas las filas de un mismo empleado.
 */

export interface FilaHorasCentroCSV {
  empleado: string;
  centro: string;
  horas: number;
  /** Horas del empleado en el periodo sumando todos sus centros. */
  horasTotales?: number;
  /** Horas de contrato imputables al periodo. */
  horasContrato?: number;
  /** `horasTotales − horasContrato`. Positiva = horas extra. */
  diferencia?: number;
}

export function generarCSVHorasPorCentro(filas: FilaHorasCentroCSV[]): string {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const num = (n: number) => esc(String(n).replace(".", ","));
  // Las columnas de contrato solo se escriben si el origen de los datos las
  // trae. Así el CSV sigue siendo válido para cualquier llamada antigua que
  // pase solo empleado/centro/horas.
  const conContrato = filas.some((f) => f.horasContrato !== undefined);
  const cabecera = conContrato
    ? "Empleado,Centro,Horas,Horas totales del empleado,Horas de contrato,Diferencia"
    : "Empleado,Centro,Horas";
  const cuerpo = filas.map((f) => {
    const base = [esc(f.empleado), esc(f.centro), num(f.horas)];
    if (!conContrato) return base.join(",");
    return [
      ...base,
      num(f.horasTotales ?? f.horas),
      num(f.horasContrato ?? 0),
      num(f.diferencia ?? 0),
    ].join(",");
  });
  // BOM UTF-8 para que Excel detecte la codificación correctamente.
  return "﻿" + [cabecera, ...cuerpo].join("\r\n");
}

/** Dispara la descarga del CSV en el navegador. */
export function descargarCSVHorasPorCentro(
  filas: FilaHorasCentroCSV[],
  filename: string,
): void {
  const blob = new Blob([generarCSVHorasPorCentro(filas)], {
    type: "text/csv;charset=utf-8",
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}
