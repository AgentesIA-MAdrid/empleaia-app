#!/usr/bin/env node
/**
 * import-empleados — alta masiva de empleados en un tenant a partir de un
 * Excel exportado de otro sistema de fichaje (formato "Informe de empleados").
 *
 * NO envía emails de invitación (inserta directo en el schema del tenant).
 * El admin puede disparar la invitación luego desde la ficha del empleado.
 *
 * Decisiones de mapeo (acordadas con Dani, 2026-06-25):
 *  - nombre/apellidos: el Excel trae una sola columna "Empleado"; se parte
 *    con heurística española (últimos 2 tokens = apellidos). Filas dudosas
 *    (>4 tokens o con partículas "de/la/del") se marcan [REVISAR].
 *  - email (login): prioridad Email notificaciones > E-mail personal >
 *    E-mail de empresa. Siempre en minúsculas.
 *  - capitalización: Primera Letra En Mayúscula, resto minúsculas
 *    (partículas en minúscula).
 *  - centro/tienda: se mapea SOLO el primer centro de la lista, contra las
 *    tiendas que ya existan en el tenant (match por nombre). Sin match →
 *    tiendaId null (se ajusta luego a mano).
 *  - SONIA (sin centro en el Excel) → Leganés.
 *  - rol: todos EMPLEADO. Los coordinadores se promueven luego a mano.
 *  - managerId: 2ª pasada best-effort, enlazando "Responsable directo" por
 *    nombre completo exacto contra los empleados creados.
 *
 * Idempotente: si ya existe un User con ese email, lo salta.
 *
 * Uso:
 *   # Dry-run (no escribe nada, imprime el plan):
 *   APP_DATABASE_URL=<prod-url> npx tsx scripts/import-empleados.ts mobileshop "<ruta.xlsx>"
 *   # Escribir de verdad:
 *   APP_DATABASE_URL=<prod-url> npx tsx scripts/import-empleados.ts mobileshop "<ruta.xlsx>" --commit
 */

import "dotenv/config";
import ExcelJS from "exceljs";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma-tenant/client";
import { quoteSchemaName } from "../src/lib/tenant/quote";

const PARTICULAS = new Set([
  "de", "del", "la", "las", "los", "y", "e", "da", "do", "di", "van", "von",
]);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) =>
      i > 0 && PARTICULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

function splitNombre(full: string): {
  nombre: string;
  apellidos: string;
  revisar: boolean;
} {
  const tokens = full.trim().split(/\s+/);
  const n = tokens.length;
  let nombreT: string[];
  let apellidoT: string[];
  let revisar = false;
  if (n === 1) {
    nombreT = tokens;
    apellidoT = [];
    revisar = true;
  } else if (n === 2) {
    nombreT = [tokens[0]];
    apellidoT = [tokens[1]];
  } else if (n === 3) {
    nombreT = [tokens[0]];
    apellidoT = tokens.slice(1);
  } else if (n === 4) {
    nombreT = tokens.slice(0, 2);
    apellidoT = tokens.slice(2);
  } else {
    nombreT = tokens.slice(0, n - 2);
    apellidoT = tokens.slice(n - 2);
    revisar = true;
  }
  // Partículas que quedaron al final del nombre ("…Jose de") pertenecen al
  // apellido: las arrastramos al principio de los apellidos.
  while (nombreT.length > 1 && PARTICULAS.has(nombreT[nombreT.length - 1].toLowerCase())) {
    apellidoT.unshift(nombreT.pop() as string);
  }
  if (tokens.some((t) => PARTICULAS.has(t.toLowerCase()))) revisar = true;
  return {
    nombre: titleCase(nombreT.join(" ")),
    apellidos: titleCase(apellidoT.join(" ")),
    revisar,
  };
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Palabras de ruido en los nombres de centro/tienda (cadenas, formato del
// CC, partículas) que no aportan a la identificación de la ubicación.
const RUIDO_TIENDA = new Set([
  "NEKSUS", "YOIGO", "ECI", "CC", "CL", "C", "OFICINA", "SL", "MOBILESHOP",
  "COMUNICACIONES", "DE", "DEL", "LA", "LAS", "LOS", "EL", "Y", "CENTRAL",
]);

/** Tokens significativos de un nombre de centro/tienda (sin ruido ni códigos). */
function tokensSignificativos(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(/[^A-Z0-9Ñ]+/)
      .filter(Boolean)
      .filter((t) => !RUIDO_TIENDA.has(t))
      .filter((t) => !/^[A-Z]{0,3}\d+$/.test(t)), // códigos tipo LB228807, "2"
  );
}

type Fila = {
  original: string;
  nombre: string;
  apellidos: string;
  revisar: boolean;
  email: string;
  dni: string | null;
  telefono: string | null;
  primerCentro: string;
  responsable: string;
};

function leerExcel(ruta: string): Promise<Fila[]> {
  return (async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(ruta);
    const ws = wb.worksheets[0];

    // La fila de cabeceras es la 14 en este formato; localizamos por contenido.
    let headerRow = 14;
    for (let r = 1; r <= 30; r++) {
      if (ws.getRow(r).getCell(1).text.trim() === "Empleado") {
        headerRow = r;
        break;
      }
    }
    const header: string[] = [];
    ws.getRow(headerRow).eachCell({ includeEmpty: true }, (c) =>
      header.push(c.text),
    );
    const col = (name: string) => header.indexOf(name) + 1; // 1-based; 0 si no existe

    const cN = col("Empleado");
    const cEmpEmail = col("E-mail de empresa");
    const cNotif = col("Email notificaciones");
    const cPers = col("E-mail personal");
    const cDni = col("Nº de identificación principal");
    const cTel = col("Teléfono");
    const cCentro = col("Centro");
    const cResp = col("Responsable directo");

    const filas: Fila[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const original = row.getCell(cN).text.trim();
      if (!original) continue;
      const { nombre, apellidos, revisar } = splitNombre(original);
      const email = (
        row.getCell(cNotif).text.trim() ||
        row.getCell(cPers).text.trim() ||
        row.getCell(cEmpEmail).text.trim()
      ).toLowerCase();
      const centroRaw = row.getCell(cCentro).text.trim();
      // SONIA sin centro → Leganés.
      const primerCentro =
        (centroRaw.split(",")[0] || "").trim() ||
        (/^SONIA/i.test(original) ? "LEGANES" : "");
      filas.push({
        original,
        nombre,
        apellidos,
        revisar,
        email,
        dni: row.getCell(cDni).text.trim() || null,
        telefono: row.getCell(cTel).text.trim() || null,
        primerCentro,
        responsable: row.getCell(cResp).text.trim(),
      });
    }
    return filas;
  })();
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const positional = args.filter((a) => !a.startsWith("--"));
  const slug = positional[0];
  const ruta = positional[1];

  if (!slug || !ruta) {
    console.error(
      'Uso: npx tsx scripts/import-empleados.ts <slug> "<ruta.xlsx>" [--commit]',
    );
    process.exit(2);
  }
  quoteSchemaName(slug); // valida el slug (lanza si malformado)

  const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Falta APP_DATABASE_URL (o DATABASE_URL).");

  const filas = await leerExcel(ruta);
  console.log(`\nLeídos ${filas.length} empleados del Excel.`);
  console.log(commit ? "MODO: --commit (ESCRIBE en BD)\n" : "MODO: dry-run (no escribe)\n");

  const pool = new pg.Pool({ connectionString: url });
  const adapter = new PrismaPg(pool, { schema: `tenant_${slug}` });
  const db = new PrismaClient({ adapter });

  try {
    const tiendas = await db.tienda.findMany({ select: { id: true, nombre: true } });
    // Pre-cómputo de tokens por tienda.
    const tiendasTok = tiendas.map((t) => ({ t, set: tokensSignificativos(t.nombre) }));
    const matchTienda = (centro: string): { id: string; nombre: string } | null => {
      if (!centro) return null;
      const cset = tokensSignificativos(centro);
      if (cset.size === 0) return null;
      // Candidatas: tiendas cuyos tokens significativos están TODOS en el
      // centro (subconjunto). Ordenadas por nº de tokens (más específica gana).
      const cands = tiendasTok
        .filter((c) => c.set.size > 0 && [...c.set].every((x) => cset.has(x)))
        .sort((a, b) => b.set.size - a.set.size);
      if (cands.length === 0) return null;
      // Empate al tope → ambiguo → sin tienda (lo ajustan a mano).
      if (cands.length > 1 && cands[0].set.size === cands[1].set.size) return null;
      return cands[0].t;
    };

    const existentes = new Set(
      (await db.user.findMany({ select: { email: true } })).map((u) =>
        u.email.toLowerCase(),
      ),
    );

    let creados = 0;
    let saltados = 0;
    const sinTienda: string[] = [];
    const paraRevisar: string[] = [];

    for (const f of filas) {
      const t = matchTienda(f.primerCentro);
      const flagRev = f.revisar ? " [REVISAR nombre]" : "";
      const flagT = t ? `→ ${t.nombre}` : "→ (sin tienda)";
      if (!t) sinTienda.push(f.original);
      if (f.revisar) paraRevisar.push(`${f.original}  =>  "${f.nombre}" / "${f.apellidos}"`);

      if (existentes.has(f.email)) {
        console.log(`  · SALTA (ya existe): ${f.email}`);
        saltados++;
        continue;
      }

      console.log(
        `  ${commit ? "+" : "·"} ${f.nombre} | ${f.apellidos} | ${f.email} | ${f.dni ?? "-"} | tel:${f.telefono ?? "-"} | ${flagT}${flagRev}`,
      );

      if (commit) {
        await db.user.create({
          data: {
            email: f.email,
            nombre: f.nombre,
            apellidos: f.apellidos,
            dni: f.dni ?? undefined,
            telefono: f.telefono ?? undefined,
            rol: "EMPLEADO",
            tiendaId: t?.id ?? null,
            activo: true,
          },
        });
        creados++;
      }
    }

    // 2ª pasada: enlazar managerId desde "Responsable directo" (best-effort).
    if (commit) {
      const users = await db.user.findMany({
        select: { id: true, nombre: true, apellidos: true },
      });
      const porNombre = new Map<string, string>();
      for (const u of users) {
        porNombre.set(norm(`${u.nombre} ${u.apellidos}`), u.id);
      }
      let enlazados = 0;
      for (const f of filas) {
        if (!f.responsable) continue;
        const mgrId = porNombre.get(norm(f.responsable));
        const selfId = porNombre.get(norm(`${f.nombre} ${f.apellidos}`));
        if (mgrId && selfId && mgrId !== selfId) {
          await db.user.update({ where: { id: selfId }, data: { managerId: mgrId } });
          enlazados++;
        }
      }
      console.log(`\n  managerId enlazados (Responsable directo): ${enlazados}`);
    }

    console.log(`\n── Resumen ──`);
    console.log(`  Tiendas en el tenant: ${tiendas.length}`);
    if (commit) {
      console.log(`  Creados: ${creados}  ·  Saltados (ya existían): ${saltados}`);
    } else {
      console.log(`  Se crearían: ${filas.length - saltados}  ·  Saltarían: ${saltados}`);
    }
    if (sinTienda.length) {
      console.log(`\n  ⚠️  Sin tienda mapeada (${sinTienda.length}) — ajustar a mano:`);
      sinTienda.forEach((n) => console.log(`     - ${n}`));
    }
    if (paraRevisar.length) {
      console.log(`\n  ⚠️  Nombres a revisar (${paraRevisar.length}):`);
      paraRevisar.forEach((n) => console.log(`     - ${n}`));
    }
    if (!commit) {
      console.log(`\n  Para escribir de verdad, repite con --commit`);
    }
  } finally {
    await db.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
