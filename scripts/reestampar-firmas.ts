/**
 * Vuelve a estampar el sello de las firmas ya hechas, con la hora en la zona
 * del cliente (ticket 3c91f0ab).
 *
 * Por qué: el sello que va impreso en el PDF se escribía con
 * `toLocaleString("es-ES")` sin zona, y el contenedor de producción corre en
 * UTC, así que decía dos horas menos de las que marcó el reloj de quien firmó.
 * El instante guardado en `Firma.firmadoEn` SÍ era correcto, y también el hash
 * probatorio —que se calcula del documento original, no del sellado—, así que
 * volver a estampar no toca la prueba: solo corrige lo que se lee en el papel.
 *
 * Se rehace a partir de lo que ya está en la base: el documento original, el
 * garabato de la firma y el instante exacto. Idempotente: pasarlo dos veces
 * deja el mismo sello.
 *
 * Uso (dentro del contenedor de la app, que ya tiene el tenant resuelto por
 * variable de entorno):
 *
 *   TENANT_SLUG=mobileshop npx tsx scripts/reestampar-firmas.ts          # en seco
 *   TENANT_SLUG=mobileshop npx tsx scripts/reestampar-firmas.ts --aplicar
 */

import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma-tenant/client";
import { estamparFirmaEnDocumento } from "../src/lib/firmas/estampar";
import { ZONA_DEFECTO } from "../src/lib/fechas/zona";

const slug = process.env.TENANT_SLUG;
const aplicar = process.argv.includes("--aplicar");

if (!slug) {
  console.error("Falta TENANT_SLUG (el slug del tenant, p. ej. mobileshop).");
  process.exit(1);
}

const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Falta APP_DATABASE_URL / DATABASE_URL.");
  process.exit(1);
}

// Mismo montaje que `prismaApp` por dentro: el schema del tenant va en el
// adaptador, no en la connection string (ver src/lib/prisma.ts).
const prisma = new PrismaClient({
  adapter: new PrismaPg(new pg.Pool({ connectionString: url }), { schema: `tenant_${slug}` }),
  log: ["error"],
});

async function main() {
  const cfg = await prisma.configuracionEmpresa.findUnique({
    where: { id: "singleton" },
    select: { zonaHoraria: true },
  });
  const zona = cfg?.zonaHoraria ?? ZONA_DEFECTO;

  const firmas = await prisma.firma.findMany({
    where: { documentoFirmadoUrl: { not: null } },
    select: {
      id: true,
      firmanteNombre: true,
      firmanteDni: true,
      firmadoEn: true,
      firmaImagen: true,
      documento: { select: { nombre: true, url: true } },
    },
    orderBy: { firmadoEn: "asc" },
  });

  console.log(`Tenant ${slug} · zona ${zona} · ${firmas.length} firmas con sello`);
  let rehechas = 0;
  let sinDocumento = 0;
  let fallidas = 0;

  for (const f of firmas) {
    if (!f.documento?.url || !f.firmaImagen) {
      sinDocumento += 1;
      console.log(`  – ${f.id}: sin documento original o sin garabato, se deja como está`);
      continue;
    }
    try {
      const nuevo = await estamparFirmaEnDocumento({
        documentoUrl: f.documento.url,
        garabatoUrl: f.firmaImagen,
        // En firmas antiguas el nombre o el DNI pueden faltar: el sello se
        // imprime igual, con lo que haya.
        nombre: f.firmanteNombre ?? "",
        dni: f.firmanteDni ?? "",
        fecha: f.firmadoEn,
        zonaHoraria: zona,
      });
      if (!nuevo) {
        fallidas += 1;
        console.log(`  ! ${f.id}: el documento no es estampable (${f.documento.nombre})`);
        continue;
      }
      if (aplicar) {
        await prisma.firma.update({ where: { id: f.id }, data: { documentoFirmadoUrl: nuevo } });
      }
      rehechas += 1;
      console.log(
        `  ✓ ${f.id} · ${f.firmanteNombre} · ${f.firmadoEn.toISOString()} · ${f.documento.nombre}`,
      );
    } catch (err) {
      fallidas += 1;
      console.error(`  ! ${f.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `${aplicar ? "Aplicado" : "En seco (sin --aplicar no se escribe nada)"}: ` +
      `${rehechas} rehechas, ${sinDocumento} sin documento, ${fallidas} con fallo`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
