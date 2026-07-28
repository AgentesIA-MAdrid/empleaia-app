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
 */

export interface FilaHorasCentroCSV {
  empleado: string;
  centro: string;
  horas: number;
}

export function generarCSVHorasPorCentro(filas: FilaHorasCentroCSV[]): string {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const cuerpo = filas.map((f) =>
    [esc(f.empleado), esc(f.centro), esc(String(f.horas).replace(".", ","))].join(","),
  );
  // BOM UTF-8 para que Excel detecte la codificación correctamente.
  return "﻿" + ["Empleado,Centro,Horas", ...cuerpo].join("\r\n");
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
