import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { generarCSV, generarExcel, generarPDF } from "./generators";

const SAMPLE: Record<string, unknown> = {
  tipo: "fichajes",
  total: 2,
  data: [
    {
      id: "f1",
      tipo: "ENTRADA",
      timestamp: new Date("2026-04-15T08:00:00Z"),
      user: { id: "u1", nombre: "Ana", apellidos: "García", email: "ana@x.com" },
      tienda: { id: "t1", nombre: "Sede Centro" },
      latitud: null,
      longitud: null,
    },
    {
      id: "f2",
      tipo: "SALIDA",
      timestamp: new Date("2026-04-15T17:00:00Z"),
      user: { id: "u1", nombre: "Ana", apellidos: "García", email: "ana@x.com" },
      tienda: { id: "t1", nombre: "Sede Centro" },
      latitud: null,
      longitud: null,
    },
  ],
};

describe("generarCSV", () => {
  it("incluye BOM UTF-8 + headers + filas separadas por CRLF", () => {
    const csv = generarCSV(SAMPLE);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const stripped = csv.slice(1);
    const lines = stripped.split("\r\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(3); // headers + 2 rows
    expect(lines[0]).toContain("empleado");
    expect(lines[0]).toContain("tienda");
    expect(lines[1]).toContain("Ana García");
    expect(lines[1]).toContain("Sede Centro");
    expect(lines[1]).toContain("ENTRADA");
  });

  it("escapa valores con coma o comillas según RFC 4180", () => {
    const payload = {
      tipo: "x",
      data: [{ a: 'con "comillas"', b: "con,coma", c: "normal" }],
    };
    const csv = generarCSV(payload);
    expect(csv).toContain('"con ""comillas"""');
    expect(csv).toContain('"con,coma"');
    expect(csv).toContain("normal");
  });

  it("payload vacío devuelve mensaje de sin datos", () => {
    const csv = generarCSV({ tipo: "x", data: [] });
    expect(csv).toContain("no hay datos");
  });
});

describe("generarExcel", () => {
  it("produce un buffer leíble como XLSX con headers correctos", async () => {
    const buf = await generarExcel(SAMPLE);
    expect(buf.length).toBeGreaterThan(0);
    // Verifica magic bytes ZIP (xlsx es zip).
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toContain("fichajes");
    const sheet = wb.getWorksheet("fichajes")!;
    const headerRow = (sheet.getRow(1).values as unknown[]).slice(1);
    const dataRow = (sheet.getRow(2).values as unknown[]).slice(1);
    expect(headerRow).toContain("empleado");
    expect(dataRow).toContain("Ana García");
  });

  it("añade hoja con stats si payload tiene stats", async () => {
    const buf = await generarExcel({
      tipo: "resumen",
      empleados: [{ userId: "u1", nombre: "Ana", apellidos: "G", horasTotales: 8 }],
      stats: { totalHoras: 8, mediaHorasDia: 8 },
      total: 1,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    // tipo="resumen" hace que la hoja extra se llame "Estadísticas"
    // para evitar colisión con la hoja principal.
    expect(wb.worksheets.map((w) => w.name)).toContain("Estadísticas");
  });
});

describe("generarPDF", () => {
  it("produce un buffer con magic bytes PDF", () => {
    const buf = generarPDF(SAMPLE);
    expect(buf.length).toBeGreaterThan(100);
    // Magic bytes %PDF
    expect(buf[0]).toBe(0x25); // %
    expect(buf[1]).toBe(0x50); // P
    expect(buf[2]).toBe(0x44); // D
    expect(buf[3]).toBe(0x46); // F
  });

  it("payload vacío produce PDF con mensaje 'sin datos'", () => {
    const buf = generarPDF({ tipo: "fichajes", data: [] });
    expect(buf.length).toBeGreaterThan(100);
  });
});

describe("hoja de incidencias (ticket c1e94a7b)", () => {
  const CON_INCIDENCIAS: Record<string, unknown> = {
    tipo: "resumen",
    empleados: [{ nombre: "Ana", horasTotales: 120 }],
    incidenciasTurnos: [
      {
        Fecha: "2026-07-15",
        Empleado: "Luis Pérez",
        Sede: "NEKSUS CARTAGENA",
        Turno: "10:00-17:00",
        Incidencia: "Turno previsto sin fichaje (no trabajado)",
        Detalle: "Corregido el 2026-08-01",
      },
    ],
  };

  it("los turnos no trabajados salen en su propia hoja, no en la principal", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const buf = await generarExcel(CON_INCIDENCIAS);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);

    const hojas = wb.worksheets.map((w) => w.name);
    expect(hojas).toContain("Incidencias");

    const ws = wb.getWorksheet("Incidencias")!;
    // Cabecera + una fila.
    expect(ws.rowCount).toBe(2);
    expect(ws.getRow(2).values).toContain("Luis Pérez");
    expect(ws.getRow(2).values).toContain("10:00-17:00");
  });

  it("sin incidencias no se añade la hoja: no se enseña una pestaña vacía", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const buf = await generarExcel({ tipo: "resumen", empleados: [{ nombre: "Ana" }] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).not.toContain("Incidencias");
  });
});
