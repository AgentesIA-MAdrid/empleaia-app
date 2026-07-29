/**
 * Lectura de la primera hoja de un .xlsx a matriz de texto.
 *
 * Aparte de `catalogo.ts` porque esto sí toca una dependencia pesada (exceljs)
 * y se carga con `import()` dinámico para no arrastrarla en cada bundle. Vive
 * separado del handler para poder probarlo con un Excel de verdad.
 */

/** @param datos contenido del .xlsx */
export async function leerHojaExcel(datos: Buffer | Uint8Array): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  // `xlsx.load` tipa su parámetro con el Buffer más reciente de @types/node;
  // se le pasa el ArrayBuffer subyacente para no pelearse con esa firma.
  await wb.xlsx.load(new Uint8Array(datos).buffer as ArrayBuffer);
  const hoja = wb.worksheets[0];
  if (!hoja) return [];

  const matriz: string[][] = [];
  hoja.eachRow({ includeEmpty: false }, (row) => {
    // `row.values` es 1-based: el índice 0 viene vacío.
    const valores = Array.isArray(row.values) ? row.values.slice(1) : [];
    matriz.push(
      valores.map((v) => {
        if (v === null || v === undefined) return "";
        // Celdas con formato enriquecido, fórmula o hipervínculo.
        if (typeof v === "object" && "text" in v) return String((v as { text?: unknown }).text ?? "");
        if (typeof v === "object" && "result" in v) return String((v as { result?: unknown }).result ?? "");
        return String(v);
      }),
    );
  });
  return matriz;
}
