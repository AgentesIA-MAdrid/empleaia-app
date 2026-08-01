/**
 * Carga el fondo de caja de cada sede desde un Excel (ticket 7ab2c5d9).
 *
 * El cliente manda la hoja con el formato de la plantilla de objetivos, que es
 * la que ya conoce:
 *
 *   Ámbito | Comercial, punto de venta o grupo | Id | FONDO DE CAJA A 31/07/2026
 *   Sede   | NEKSUS CARTAGENA                  | 6fe…| 239,32
 *   Sede   | NEKSUS CC ISLA AZUL               | 944…| INCIDENCIA
 *   Sede   | OFICINA LEGANES                   | 9c4…| SEDE EXENTA DE ARQUEOS Y CONCILIACIONES
 *
 * Qué hace con cada fila:
 *
 *  - Un número → se guarda como fondo de la sede a esa fecha. Admite negativos:
 *    si falta dinero, el dato tiene que poder contarlo.
 *  - "INCIDENCIA" → se guarda SIN importe y con la incidencia escrita. La caja de
 *    esa sede no se puede dar por buena todavía, y poner un 0 sería mentir.
 *  - "SEDE EXENTA…" → se salta. La exención es un concepto que aún no existe en
 *    el producto y no se inventa aquí.
 *
 * La sede se busca por su id de la columna Id y, si no cuadra, por nombre: la
 * hoja se rehace a mano y un id copiado a medias no debe cargar el fondo en la
 * tienda equivocada.
 *
 * Uso (en el contenedor de la app):
 *   TENANT_SLUG=mobileshop npx tsx scripts/cargar-fondo-caja.ts <fichero.xlsx> <YYYY-MM-DD>
 *   TENANT_SLUG=mobileshop npx tsx scripts/cargar-fondo-caja.ts <fichero.xlsx> <YYYY-MM-DD> --aplicar
 *
 * Sin `--aplicar` no escribe nada: enseña qué haría.
 */

import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import ExcelJS from "exceljs";
import { PrismaClient } from "../src/generated/prisma-tenant/client";

const [fichero, dia] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const aplicar = process.argv.includes("--aplicar");
const slug = process.env.TENANT_SLUG;

if (!slug || !fichero || !dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
  console.error(
    "Uso: TENANT_SLUG=<slug> npx tsx scripts/cargar-fondo-caja.ts <fichero.xlsx> <YYYY-MM-DD> [--aplicar]",
  );
  process.exit(1);
}

const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Falta APP_DATABASE_URL / DATABASE_URL.");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(new pg.Pool({ connectionString: url }), { schema: `tenant_${slug}` }),
  log: ["error"],
});

/** Quita tildes y espacios de sobra, para casar nombres escritos a mano. */
function normalizar(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** "239,32" y "239.32" son lo mismo; "-4,48" es un fondo negativo. */
function parseImporte(bruto: string): number | null {
  const limpio = bruto.replace(/[€\s]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = Number.parseFloat(limpio);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fichero!);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("El fichero no tiene ninguna hoja.");

  const sedes = await prisma.tienda.findMany({ select: { id: true, nombre: true, activa: true } });
  const porId = new Map(sedes.map((t) => [t.id, t]));
  const porNombre = new Map(sedes.map((t) => [normalizar(t.nombre), t]));

  const fecha = new Date(`${dia}T00:00:00Z`);
  let cargadas = 0;
  let conIncidencia = 0;
  let saltadas = 0;

  const filas: { row: number; celdas: string[] }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const celdas = ((row.values ?? []) as unknown[]).slice(1).map((v) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "object" && v !== null && "result" in (v as object)) {
        return String((v as { result?: unknown }).result ?? "");
      }
      if (typeof v === "object" && v !== null && "text" in (v as object)) {
        return String((v as { text?: unknown }).text ?? "");
      }
      return String(v);
    });
    filas.push({ row: n, celdas });
  });

  for (const { row, celdas } of filas) {
    // La cabecera y las filas vacías se saltan solas: no casan con ninguna sede.
    const [, nombre = "", id = "", valor = ""] = celdas;
    const sede = (id && porId.get(id.trim())) || porNombre.get(normalizar(nombre));
    if (!sede) {
      if (nombre && normalizar(nombre) !== "comercial, punto de venta o grupo") {
        console.log(`  – fila ${row}: "${nombre}" no casa con ninguna sede, se salta`);
        saltadas += 1;
      }
      continue;
    }

    const texto = valor.trim();
    const normalizado = normalizar(texto);

    if (normalizado.includes("exenta")) {
      console.log(`  – ${sede.nombre}: exenta de arqueos, se salta (concepto aún no existe)`);
      saltadas += 1;
      continue;
    }

    if (normalizado.includes("incidencia")) {
      console.log(`  ! ${sede.nombre}: INCIDENCIA, se guarda sin importe`);
      conIncidencia += 1;
      if (aplicar) {
        await prisma.fondoCaja.upsert({
          where: { tiendaId_fecha: { tiendaId: sede.id, fecha } },
          create: {
            tiendaId: sede.id,
            fecha,
            importe: null,
            incidencia: "Caja pendiente de aclarar: sin fondo fiable a esta fecha.",
          },
          update: {
            importe: null,
            incidencia: "Caja pendiente de aclarar: sin fondo fiable a esta fecha.",
          },
        });
      }
      continue;
    }

    const importe = parseImporte(texto);
    if (importe === null) {
      console.log(`  – ${sede.nombre}: "${texto}" no es un importe, se salta`);
      saltadas += 1;
      continue;
    }

    console.log(`  ✓ ${sede.nombre}: ${importe.toFixed(2)} €${importe < 0 ? "  (NEGATIVO)" : ""}`);
    cargadas += 1;
    if (aplicar) {
      await prisma.fondoCaja.upsert({
        where: { tiendaId_fecha: { tiendaId: sede.id, fecha } },
        create: { tiendaId: sede.id, fecha, importe, incidencia: null },
        update: { importe, incidencia: null },
      });
    }
  }

  console.log(
    `\n${aplicar ? "Aplicado" : "En seco (sin --aplicar no se escribe nada)"}: ` +
      `${cargadas} con importe, ${conIncidencia} con incidencia, ${saltadas} saltadas`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
