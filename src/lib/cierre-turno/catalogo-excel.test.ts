import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { leerHojaExcel } from "./catalogo-excel";
import { construirCatalogo } from "./catalogo";

/**
 * Prueba con un .xlsx de verdad, generado aquí mismo: es el formato en el que
 * va a llegar el catálogo del cliente. Un parser de Excel que solo se prueba
 * con matrices de mentira no demuestra nada sobre el fichero real.
 */
async function excelDePrueba(filas: (string | number | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet("Catálogo");
  filas.forEach((f) => hoja.addRow(f));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe("leerHojaExcel", () => {
  it("lee un xlsx con encabezado y celdas de texto", async () => {
    const xlsx = await excelDePrueba([
      ["Artículo", "Categoría"],
      ["Alta de fibra", "Telefonía"],
      ["Portabilidad móvil", "Móvil"],
    ]);
    const matriz = await leerHojaExcel(xlsx);
    expect(matriz).toEqual([
      ["Artículo", "Categoría"],
      ["Alta de fibra", "Telefonía"],
      ["Portabilidad móvil", "Móvil"],
    ]);
  });

  it("convierte números a texto (un código de artículo numérico es válido)", async () => {
    const xlsx = await excelDePrueba([["Artículo"], [12345]]);
    const matriz = await leerHojaExcel(xlsx);
    expect(matriz[1]).toEqual(["12345"]);
  });

  it("un libro sin hojas devuelve matriz vacía en lugar de reventar", async () => {
    const wb = new ExcelJS.Workbook();
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(leerHojaExcel(buf)).resolves.toEqual([]);
  });
});

describe("Excel real → catálogo", () => {
  it("importa la hoja tal como la mantendría un cliente en Excel", async () => {
    // Encabezados en español, una fila en blanco en medio, espacios de más y un
    // duplicado con distinta caja: todo eso pasa en hojas reales.
    const xlsx = await excelDePrueba([
      ["Servicio", "Familia"],
      ["  Alta de fibra  ", "Telefonía"],
      [null, null],
      ["Portabilidad", "Móvil"],
      ["ALTA DE FIBRA", "Telefonía"],
      ["Instalación de router", null],
    ]);

    const { filas, ignoradas, conCabecera } = construirCatalogo(await leerHojaExcel(xlsx));

    expect(conCabecera).toBe(true);
    expect(filas.map((f) => f.nombre)).toEqual([
      "Alta de fibra",
      "Portabilidad",
      "Instalación de router",
    ]);
    expect(filas.map((f) => f.orden)).toEqual([0, 1, 2]);
    expect(filas[2]?.categoria).toBeNull();
    // El duplicado se avisa; la fila vacía no ensucia el informe.
    expect(ignoradas).toHaveLength(1);
    expect(ignoradas[0]?.motivo).toContain("Repetido");
  });

  it("una hoja de una sola columna sin encabezado también vale", async () => {
    const xlsx = await excelDePrueba([["Cambio de tarifa"], ["Alta de línea"]]);
    const { filas, conCabecera } = construirCatalogo(await leerHojaExcel(xlsx));
    expect(conCabecera).toBe(false);
    expect(filas.map((f) => f.nombre)).toEqual(["Cambio de tarifa", "Alta de línea"]);
  });
});
