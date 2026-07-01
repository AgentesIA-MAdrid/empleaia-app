/**
 * Plantilla de actualización masiva de empleados + importación de vuelta.
 *
 * Flujo: el OWNER descarga la plantilla Excel (una fila por empleado, con
 * sus datos actuales), la edita en Excel y la vuelve a subir. La
 * importación **solo actualiza** empleados existentes (match por Email);
 * NO crea empleados nuevos ni añade columnas. Una celda vacía deja el
 * campo sin cambios (semántica no destructiva).
 *
 * Lógica pura compartida por `/api/empleados/plantilla` (descarga) y
 * `/api/empleados/importar` (subida), recibiendo `prismaApp` por
 * dependencia. NO fetch interno entre rutas (AGENTS.md).
 */

import ExcelJS from "exceljs";
import type { PrismaClient } from "@/generated/prisma-tenant/client";

export type ColTipo = "texto" | "numero" | "email";

export interface ColumnaPlantilla {
  header: string;
  campo: string;
  tipo: ColTipo;
}

/**
 * Columnas de la plantilla. La primera (`Email`) es la CLAVE de match y no
 * se puede cambiar desde el Excel (para editar el email, usa la ficha). El
 * resto son campos existentes editables en bloque.
 */
export const COLUMNAS_PLANTILLA: ColumnaPlantilla[] = [
  { header: "Email", campo: "email", tipo: "email" },
  { header: "Nombre", campo: "nombre", tipo: "texto" },
  { header: "Apellidos", campo: "apellidos", tipo: "texto" },
  { header: "DNI", campo: "dni", tipo: "texto" },
  { header: "Teléfono", campo: "telefono", tipo: "texto" },
  { header: "Nacionalidad", campo: "nacionalidad", tipo: "texto" },
  { header: "Estado civil", campo: "estadoCivil", tipo: "texto" },
  { header: "Género", campo: "genero", tipo: "texto" },
  { header: "Domicilio", campo: "domicilio", tipo: "texto" },
  { header: "Código postal", campo: "codigoPostal", tipo: "texto" },
  { header: "Localidad", campo: "localidad", tipo: "texto" },
  { header: "Provincia", campo: "provincia", tipo: "texto" },
  { header: "País", campo: "pais", tipo: "texto" },
  { header: "Email empresa", campo: "emailEmpresa", tipo: "email" },
  { header: "Email personal", campo: "emailPersonal", tipo: "email" },
  { header: "Teléfono empresa", campo: "telefonoEmpresa", tipo: "texto" },
  { header: "Teléfono emergencia", campo: "telefonoEmergencia", tipo: "texto" },
  { header: "Grupo cotización", campo: "grupoCotizacion", tipo: "texto" },
  { header: "Categoría profesional", campo: "categoriaProfesional", tipo: "texto" },
  { header: "Nº Seguridad Social", campo: "numeroSeguridadSocial", tipo: "texto" },
  { header: "Código contrato", campo: "codigoContrato", tipo: "texto" },
  { header: "IBAN", campo: "iban", tipo: "texto" },
  { header: "Titular cuenta", campo: "titularCuenta", tipo: "texto" },
  { header: "Horas semanales", campo: "horasSemanalesContrato", tipo: "numero" },
];

/** Campos editables (todos menos la clave Email). */
const CAMPOS_EDITABLES = COLUMNAS_PLANTILLA.filter((c) => c.campo !== "email");
const CAMPO_POR_HEADER = new Map(
  COLUMNAS_PLANTILLA.map((c) => [c.header.trim().toLowerCase(), c]),
);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Campos que Prisma selecciona para pre-rellenar la plantilla. */
const SELECT_PLANTILLA = Object.fromEntries(
  COLUMNAS_PLANTILLA.map((c) => [c.campo, true]),
) as Record<string, true>;

export interface ResultadoImportacion {
  totalFilas: number;
  actualizadas: number;
  sinCambios: number;
  errores: { fila: number; email: string; motivo: string }[];
}

/** Normaliza el valor de una celda ExcelJS a string plano y recortado. */
function celdaTexto(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const o = value as { text?: unknown; result?: unknown; richText?: { text?: string }[] };
    if (typeof o.text === "string") return o.text.trim();
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text ?? "").join("").trim();
    if (o.result !== undefined && o.result !== null) return String(o.result).trim();
  }
  return "";
}

/**
 * Genera la plantilla Excel de actualización masiva. Cabeceras fijas de
 * `COLUMNAS_PLANTILLA` + una fila por empleado con sus valores actuales.
 */
export async function generarPlantillaEmpleados(
  empleados: Record<string, unknown>[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Empleados");
  ws.addRow(COLUMNAS_PLANTILLA.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  for (const e of empleados) {
    ws.addRow(
      COLUMNAS_PLANTILLA.map((c) => {
        const v = e[c.campo];
        if (v === null || v === undefined) return "";
        return typeof v === "object" ? String(v) : (v as string | number);
      }),
    );
  }
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

/** Select para pre-rellenar la plantilla (lo usa el handler de descarga). */
export function selectPlantilla(): Record<string, true> {
  return SELECT_PLANTILLA;
}

/**
 * Parsea el Excel subido y actualiza los empleados existentes (match por
 * Email). Devuelve un resumen por filas. No lanza por filas inválidas: las
 * acumula en `errores`.
 */
export async function importarEmpleados(
  prisma: PrismaClient,
  buffer: Buffer,
  opts: { empresaId?: string | null } = {},
): Promise<ResultadoImportacion> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const resultado: ResultadoImportacion = {
    totalFilas: 0,
    actualizadas: 0,
    sinCambios: 0,
    errores: [],
  };
  if (!ws) {
    throw new Error("El archivo no contiene ninguna hoja");
  }

  // Mapea índice de columna (1-based) → definición, leyendo la cabecera.
  const headerRow = ws.getRow(1);
  const colToCampo = new Map<number, ColumnaPlantilla>();
  let emailCol = -1;
  headerRow.eachCell((cell, colNumber) => {
    const def = CAMPO_POR_HEADER.get(celdaTexto(cell.value).toLowerCase());
    if (!def) return;
    colToCampo.set(colNumber, def);
    if (def.campo === "email") emailCol = colNumber;
  });
  if (emailCol === -1) {
    throw new Error('No se encontró la columna "Email" en el archivo');
  }

  const lastRow = ws.rowCount;
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const email = celdaTexto(row.getCell(emailCol).value).toLowerCase();
    // Fila totalmente vacía → ignorar (sin contar).
    const algunValor = Array.from(colToCampo.keys()).some(
      (c) => celdaTexto(row.getCell(c).value) !== "",
    );
    if (!email && !algunValor) continue;

    resultado.totalFilas++;
    if (!email) {
      resultado.errores.push({ fila: r, email: "", motivo: "Falta el email (clave de la fila)" });
      continue;
    }

    const empleado = await prisma.user.findFirst({
      where: {
        email,
        anonimizadoAt: null,
        ...(opts.empresaId ? { empresaId: opts.empresaId } : {}),
      },
      select: { id: true },
    });
    if (!empleado) {
      resultado.errores.push({ fila: r, email, motivo: "No hay ningún empleado con ese email" });
      continue;
    }

    // Construye el update solo con celdas no vacías (vacío = sin cambios).
    const updateData: Record<string, string | number | null> = {};
    let errorFila: string | null = null;
    for (const def of CAMPOS_EDITABLES) {
      const colNumber = [...colToCampo.entries()].find(([, d]) => d === def)?.[0];
      if (colNumber === undefined) continue;
      const raw = celdaTexto(row.getCell(colNumber).value);
      if (raw === "") continue; // no tocar

      if (def.tipo === "email") {
        if (!EMAIL_RE.test(raw)) {
          errorFila = `${def.header}: email inválido`;
          break;
        }
        updateData[def.campo] = raw;
      } else if (def.tipo === "numero") {
        const n = Number(raw.replace(",", "."));
        if (Number.isNaN(n) || n < 0 || n > 168) {
          errorFila = `${def.header}: número inválido (0–168)`;
          break;
        }
        updateData[def.campo] = n;
      } else {
        updateData[def.campo] = raw;
      }
    }

    if (errorFila) {
      resultado.errores.push({ fila: r, email, motivo: errorFila });
      continue;
    }
    if (Object.keys(updateData).length === 0) {
      resultado.sinCambios++;
      continue;
    }

    try {
      await prisma.user.update({ where: { id: empleado.id }, data: updateData });
      resultado.actualizadas++;
    } catch (e) {
      // Colisión de único (p. ej. DNI duplicado) u otro error de fila.
      const code = (e as { code?: string }).code;
      resultado.errores.push({
        fila: r,
        email,
        motivo: code === "P2002" ? "Valor duplicado (DNI ya en uso)" : "No se pudo guardar la fila",
      });
    }
  }

  return resultado;
}
