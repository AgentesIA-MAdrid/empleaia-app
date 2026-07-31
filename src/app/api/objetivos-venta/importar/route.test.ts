/**
 * /api/objetivos-venta/importar — permisos y qué escribe de verdad.
 *
 * Se invoca al handler directamente con un NextRequest (sin levantar HTTP) y
 * con Prisma mockeado, igual que `../route.test.ts`. Se sube un CSV porque es
 * el mismo camino que un .xlsx a partir de la matriz de celdas, y la lectura
 * del Excel de verdad ya está probada en
 * `src/lib/cierre-turno/objetivos-plantilla.test.ts`.
 *
 * Lo que se protege aquí:
 *  1. Coordinación no importa: los objetivos los fija administración.
 *  2. Una casilla vacía NO borra el objetivo que hubiera; el 0 sí lo quita.
 *  3. Lo que ya vale lo que dice la hoja no se reescribe.
 *  4. Una plantilla de otro mes no se vuelca encima del mes en pantalla.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_owner", rol: "OWNER", tiendaId: null as string | null, name: "Owner" },
};

const objetivosExistentes: {
  id: string;
  userId: string | null;
  tiendaId: string | null;
  articuloId: string | null;
  categoria: string | null;
  subcategoria: string | null;
  cantidad: number;
}[] = [];

const prismaMock = {
  objetivoVenta: {
    findMany: vi.fn(async () => objetivosExistentes),
    deleteMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async () => ({ id: "obj_1" })),
    createMany: vi.fn(async () => ({ count: 1 })),
  },
  articuloVenta: {
    findMany: vi.fn(async () => [
      {
        id: "art_fibra",
        nombre: "Alta de fibra",
        categoria: "Telefonía",
        subcategoria: "Hogar",
        cuentaParaObjetivos: true,
      },
    ]),
  },
  tienda: { findMany: vi.fn(async () => [{ id: "t1", nombre: "Centro" }]) },
  user: {
    findMany: vi.fn(async () => [{ id: "u_ana", nombre: "Ana", apellidos: "García" }]),
  },
  // Grupos de objetivos del cliente: el tercer ámbito de la hoja (ff5ab304).
  grupoObjetivo: { findMany: vi.fn(async () => [{ id: "g_tmt", nombre: "TMT" }]) },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
};

vi.mock("@/lib/prisma", () => ({
  prismaApp: prismaMock,
  prismaMaster: {},
  prismaRuntime: {},
  prismaQuotaWriter: {},
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => sesion),
}));

const ctx = {
  tenantId: "tnt_1",
  slug: "acme",
  status: "active" as const,
  features: new Map([
    ["cierre_turno", { key: "cierre_turno", value: true, source: "plan" as const, expiresAt: null }],
  ]),
};

vi.mock("@/lib/tenant/with-tenant", async () => {
  const { runWithTenant } = await import("@/lib/tenant/context");
  return {
    withTenant:
      <Args extends unknown[]>(
        h: (req: import("next/server").NextRequest, ...rest: Args) => Promise<Response> | Response,
      ) =>
      async (req: import("next/server").NextRequest, ...rest: Args) =>
        runWithTenant(ctx, () => h(req, ...rest)),
  };
});

/** Plantilla en CSV: cabecera de la hoja y una fila por sujeto. */
function csv(filas: string[][]): string {
  return filas.map((f) => f.join(";")).join("\n");
}

// La hoja de hoy: unidades totales y un grupo por subcategoría, sin columnas de
// producto (ticket 528694fa).
const CABECERA = ["Ámbito", "Comercial o punto de venta", "Id", "Unidades totales", "Grupo: Hogar"];

async function importar(contenido: string, mes = "2026-07") {
  const { POST } = await import("./route");
  const { NextRequest } = await import("next/server");
  return POST(
    new NextRequest("http://acme.localhost:3000/api/objetivos-venta/importar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mes,
        nombreFichero: "objetivos.csv",
        contenidoBase64: Buffer.from(contenido, "utf8").toString("base64"),
      }),
    }),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  objetivosExistentes.length = 0;
  sesion.user = { id: "u_owner", rol: "OWNER", tiendaId: null, name: "Owner" };
  prismaMock.objetivoVenta.findMany.mockResolvedValue(objetivosExistentes);
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("POST /api/objetivos-venta/importar", () => {
  it("el coordinador no importa objetivos: los fija administración", async () => {
    sesion.user = { id: "u_jefe", rol: "MANAGER", tiendaId: "t1", name: "Jefe" };
    const res = await importar(csv([CABECERA, ["Comercial", "Ana García", "u_ana", "40", "12"]]));
    expect(res.status).toBe(403);
    expect(prismaMock.objetivoVenta.createMany).not.toHaveBeenCalled();
  });

  it("crea los objetivos que trae la hoja", async () => {
    const res = await importar(
      csv([
        ["Mes", "2026-07"],
        CABECERA,
        ["Comercial", "Ana García", "u_ana", "40", "12"],
        ["Sede", "Centro", "t1", "90", ""],
      ]),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { creados: number; borrados: number };
    expect(data.creados).toBe(3);
    expect(prismaMock.objetivoVenta.createMany).toHaveBeenCalledWith({
      data: [
        { mes: "2026-07", userId: "u_ana", tiendaId: null, grupoId: null, articuloId: null, categoria: null, subcategoria: null, cantidad: 40 },
        { mes: "2026-07", userId: "u_ana", tiendaId: null, grupoId: null, articuloId: null, categoria: null, subcategoria: "Hogar", cantidad: 12 },
        { mes: "2026-07", userId: null, tiendaId: "t1", grupoId: null, articuloId: null, categoria: null, subcategoria: null, cantidad: 90 },
      ],
    });
  });

  it("importa también las filas de un grupo de objetivos (ticket ff5ab304)", async () => {
    const res = await importar(
      csv([
        ["Mes", "2026-07"],
        CABECERA,
        ["Grupo", "TMT", "g_tmt", "200", ""],
      ]),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.objetivoVenta.createMany).toHaveBeenCalledWith({
      data: [
        {
          mes: "2026-07",
          userId: null,
          tiendaId: null,
          grupoId: "g_tmt",
          articuloId: null,
          categoria: null,
          subcategoria: null,
          cantidad: 200,
        },
      ],
    });
  });

  it("una casilla vacía no borra el objetivo que hubiera; el 0 sí lo quita", async () => {
    objetivosExistentes.push(
      { id: "obj_total", userId: "u_ana", tiendaId: null, articuloId: null, categoria: null, subcategoria: null, cantidad: 40 },
      { id: "obj_hogar", userId: "u_ana", tiendaId: null, articuloId: null, categoria: null, subcategoria: "Hogar", cantidad: 12 },
    );
    const res = await importar(csv([CABECERA, ["Comercial", "Ana García", "u_ana", "", "0"]]));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { borrados: number; creados: number };
    expect(data.borrados).toBe(1);
    expect(data.creados).toBe(0);
    // Solo se borra el del grupo (el 0). El total, que venía en blanco, sigue.
    expect(prismaMock.objetivoVenta.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["obj_hogar"] } },
    });
  });

  it("lo que ya vale lo que dice la hoja no se reescribe", async () => {
    objetivosExistentes.push({
      id: "obj_total",
      userId: "u_ana",
      tiendaId: null,
      articuloId: null,
      categoria: null,
      subcategoria: null,
      cantidad: 40,
    });
    const res = await importar(csv([CABECERA, ["Comercial", "Ana García", "u_ana", "40", "18"]]));
    const data = (await res.json()) as { sinCambios: number; creados: number };
    expect(data.sinCambios).toBe(1);
    expect(data.creados).toBe(1);
    expect(prismaMock.objetivoVenta.update).not.toHaveBeenCalled();
  });

  it("una plantilla de otro mes no se vuelca encima del mes en pantalla", async () => {
    const res = await importar(
      csv([["Mes", "2026-06"], CABECERA, ["Comercial", "Ana García", "u_ana", "40", ""]]),
      "2026-07",
    );
    expect(res.status).toBe(400);
    expect(prismaMock.objetivoVenta.createMany).not.toHaveBeenCalled();
  });

  it("una hoja sin cabecera se rechaza en vez de adivinar columnas", async () => {
    const res = await importar(csv([["Ana García", "40"]]));
    expect(res.status).toBe(400);
    expect(prismaMock.objetivoVenta.createMany).not.toHaveBeenCalled();
  });
});
