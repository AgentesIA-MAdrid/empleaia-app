/**
 * Test unitario del importador de actualización masiva. Construye un
 * Excel en memoria (mismas cabeceras que la plantilla) y verifica el
 * parseo + validación + el resumen por filas, con un `prisma` mockeado
 * (sin BD). Cubre: update válido, fila sin cambios, email no encontrado,
 * email inválido y número fuera de rango.
 */

import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";
import {
  COLUMNAS_PLANTILLA,
  importarEmpleados,
  generarPlantillaEmpleados,
} from "./importar";

type Fila = Record<string, string>;

async function construirExcel(filas: Fila[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Empleados");
  const headers = COLUMNAS_PLANTILLA.map((c) => c.header);
  ws.addRow(headers);
  for (const fila of filas) {
    ws.addRow(headers.map((h) => fila[h] ?? ""));
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}

function prismaMock() {
  const existentes = new Set(["owner@x.com", "bob@x.com", "carol@x.com", "dave@x.com"]);
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const prisma = {
    user: {
      findFirst: vi.fn(async ({ where }: { where: { email: string } }) =>
        existentes.has(where.email) ? { id: `id_${where.email}` } : null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        return {};
      }),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { prisma: prisma as any, updates };
}

describe("importarEmpleados", () => {
  it("actualiza, ignora sin-cambios y reporta errores por fila", async () => {
    const buffer = await construirExcel([
      { Email: "owner@x.com", Nombre: "Nuevo" }, // update
      { Email: "bob@x.com" }, // sin cambios (solo clave)
      { Email: "ghost@x.com", Nombre: "X" }, // no encontrado
      { Email: "carol@x.com", "Email empresa": "no-es-email" }, // email inválido
      { Email: "dave@x.com", "Horas semanales": "200" }, // fuera de rango
    ]);

    const { prisma, updates } = prismaMock();
    const res = await importarEmpleados(prisma, buffer);

    expect(res.totalFilas).toBe(5);
    expect(res.actualizadas).toBe(1);
    expect(res.sinCambios).toBe(1);
    expect(res.errores).toHaveLength(3);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.data).toEqual({ nombre: "Nuevo" });
    const motivos = res.errores.map((e) => e.motivo).join(" | ");
    expect(motivos).toContain("ningún empleado");
    expect(motivos).toContain("email inválido");
    expect(motivos).toContain("número inválido");
  });

  it("una celda vacía deja el campo sin cambios (no lo borra)", async () => {
    const buffer = await construirExcel([
      { Email: "owner@x.com", Nombre: "Ana", Provincia: "" },
    ]);
    const { prisma, updates } = prismaMock();
    const res = await importarEmpleados(prisma, buffer);
    expect(res.actualizadas).toBe(1);
    expect(updates[0]!.data).toEqual({ nombre: "Ana" }); // provincia NO incluida
  });

  it("falla si no hay columna Email", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Empleados");
    ws.addRow(["Nombre", "Apellidos"]);
    ws.addRow(["A", "B"]);
    const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const { prisma } = prismaMock();
    await expect(importarEmpleados(prisma, buffer)).rejects.toThrow(/Email/);
  });

  it("la plantilla generada tiene cabeceras y una fila por empleado", async () => {
    const buf = await generarPlantillaEmpleados([
      { email: "a@x.com", nombre: "A", horasSemanalesContrato: "38" },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).getCell(1).value).toBe("Email");
    expect(ws.rowCount).toBe(2);
  });
});
