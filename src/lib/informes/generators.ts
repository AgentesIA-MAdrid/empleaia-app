/**
 * Generadores de exports CSV/Excel/PDF para `/api/informes/exportar`.
 *
 * Plan Fase 5 §A.2 (cierre nocturno post-fase 5). Convierten el JSON
 * shape de `/api/informes` a un buffer descargable.
 *
 * El JSON tiene shape variable según `tipo`:
 *  - fichajes/ausencias/turnos: `{ tipo, data: [...], total }`.
 *  - resumen: `{ tipo, empleados: [...], stats, total }`.
 *  - presencia: `{ empleados: [...] }`.
 *  - presencia-global: `{ tiendas: [...], stats }`.
 *
 * Los generadores aplanan los registros (extraen nombres anidados de
 * user/tienda/tipoAusencia) para que las columnas sean planas.
 */

import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type InformePayload = Record<string, unknown>;

/** Aplana un objeto del informe extrayendo nested user/tienda/tipoAusencia. */
function flattenRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (row.user && typeof row.user === "object") {
    const u = row.user as Record<string, unknown>;
    out.empleado = `${u.nombre ?? ""} ${u.apellidos ?? ""}`.trim();
    out.email = u.email;
    delete out.user;
  }
  if (row.tienda && typeof row.tienda === "object") {
    const t = row.tienda as Record<string, unknown>;
    out.tienda = t.nombre;
  } else if (row.tienda === null) {
    out.tienda = "";
  }
  if (row.tipoAusencia && typeof row.tipoAusencia === "object") {
    const ta = row.tipoAusencia as Record<string, unknown>;
    out.tipo_ausencia = ta.nombre;
    delete out.tipoAusencia;
  }
  if (row.aprobadoPor && typeof row.aprobadoPor === "object") {
    const ap = row.aprobadoPor as Record<string, unknown>;
    out.aprobado_por = `${ap.nombre ?? ""} ${ap.apellidos ?? ""}`.trim();
    delete out.aprobadoPor;
  }
  // Normaliza fechas a ISO local.
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      // ya es ISO, dejar.
    }
  }
  return out;
}

/** Extrae filas planas de un payload, según el `tipo`. */
function rowsFromPayload(payload: InformePayload): Record<string, unknown>[] {
  if (Array.isArray(payload.data)) {
    return (payload.data as Record<string, unknown>[]).map(flattenRow);
  }
  if (Array.isArray(payload.empleados)) {
    return (payload.empleados as Record<string, unknown>[]).map(flattenRow);
  }
  if (Array.isArray(payload.tiendas)) {
    return (payload.tiendas as Record<string, unknown>[]).map(flattenRow);
  }
  return [];
}

/** Devuelve las columnas a mostrar — orden estable según el primer row. */
function columnsFromRows(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (typeof row[k] === "object" && row[k] !== null) continue; // omitir objetos restantes
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

/** CSV — escape RFC 4180 (doble comilla para "), separador coma, BOM UTF-8. */
export function generarCSV(payload: InformePayload): string {
  const rows = rowsFromPayload(payload);
  const cols = columnsFromRows(rows);
  if (cols.length === 0) return "﻿no hay datos\n";
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const row of rows) {
    lines.push(cols.map((c) => escape(row[c])).join(","));
  }
  // BOM UTF-8 para que Excel detecte la codificación correctamente.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Excel — una hoja por tipo de payload con headers + filas. */
export async function generarExcel(payload: InformePayload): Promise<Buffer> {
  const rows = rowsFromPayload(payload);
  const cols = columnsFromRows(rows);
  const wb = new ExcelJS.Workbook();
  const sheetName = String(payload.tipo ?? "Informe").slice(0, 31) || "Informe";
  const ws = wb.addWorksheet(sheetName);
  if (rows.length === 0) {
    ws.addRow(["Sin datos para los filtros aplicados"]);
  } else {
    ws.addRow(cols);
    for (const row of rows) {
      ws.addRow(cols.map((c) => row[c] ?? ""));
    }
  }
  // Hoja extra "Resumen" con stats si existen. Si la hoja principal ya
  // se llama "resumen" (case-insensitive), usa "Estadísticas" para no
  // chocar — exceljs rechaza nombres duplicados aunque difiera el case.
  if (payload.stats && typeof payload.stats === "object") {
    const stats = payload.stats as Record<string, unknown>;
    const statsSheetName =
      sheetName.toLowerCase() === "resumen" ? "Estadísticas" : "Resumen";
    const wsStats = wb.addWorksheet(statsSheetName);
    wsStats.addRow(["Métrica", "Valor"]);
    for (const [k, v] of Object.entries(stats)) {
      wsStats.addRow([k, typeof v === "object" ? JSON.stringify(v) : v as string | number | boolean | null]);
    }
  }
  // Hoja "Incidencias": los turnos que estaban en el cuadrante y no se
  // trabajaron (ticket c1e94a7b). Sus horas NO cuentan en el informe de horas
  // —por eso el cliente las quería aparte— pero tienen que poder mirarse: son
  // justo los días que hay que revisar con cada persona.
  const incidencias = payload.incidenciasTurnos;
  if (Array.isArray(incidencias) && incidencias.length > 0) {
    const ws2 = wb.addWorksheet("Incidencias");
    const filas = incidencias as Record<string, unknown>[];
    const colsInc = columnsFromRows(filas);
    ws2.addRow(colsInc);
    for (const row of filas) {
      ws2.addRow(colsInc.map((c) => (row[c] ?? "") as string | number | boolean | null));
    }
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

/** PDF — tabla con jspdf-autotable, header + filas. */
export function generarPDF(payload: InformePayload): Buffer {
  const rows = rowsFromPayload(payload);
  const cols = columnsFromRows(rows);
  const doc = new jsPDF({ orientation: cols.length > 6 ? "landscape" : "portrait" });
  const titulo = `Informe ${String(payload.tipo ?? "")}`;
  doc.setFontSize(14);
  doc.text(titulo, 14, 16);
  doc.setFontSize(9);
  doc.text(
    `Generado: ${new Date().toISOString().replace("T", " ").slice(0, 19)}`,
    14,
    22,
  );
  if (rows.length === 0) {
    doc.setFontSize(11);
    doc.text("Sin datos para los filtros aplicados", 14, 35);
  } else {
    autoTable(doc, {
      head: [cols],
      body: rows.map((row) =>
        cols.map((c) => {
          const v = row[c];
          if (v === null || v === undefined) return "";
          if (typeof v === "object") return JSON.stringify(v);
          return String(v);
        }),
      ),
      startY: 28,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [99, 102, 241] },
      margin: { left: 14, right: 14 },
    });
  }
  if (payload.stats && typeof payload.stats === "object") {
    const stats = payload.stats as Record<string, unknown>;
    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 35;
    autoTable(doc, {
      head: [["Métrica", "Valor"]],
      body: Object.entries(stats).map(([k, v]) => [
        k,
        typeof v === "object" ? JSON.stringify(v) : String(v),
      ]),
      startY: finalY + 8,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [99, 102, 241] },
      margin: { left: 14, right: 14 },
    });
  }
  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
