/**
 * /api/articulos-venta — alta a mano del catálogo y renombrado.
 *
 * Se invoca al handler directamente con un NextRequest (sin levantar HTTP) y
 * con Prisma mockeado, como en `src/app/api/objetivos-venta/route.test.ts`.
 *
 * Lo que se protege aquí:
 *  1. Solo administración toca el catálogo.
 *  2. Un artículo nuevo se añade al final de la lista (el orden del catálogo es
 *     el orden en que el comercial ve la tabla del cierre).
 *  3. El mismo nombre en la misma categoría no se duplica ni cambiando tildes o
 *     mayúsculas; si el que había estaba desactivado se reactiva, para no
 *     partir el histórico de ventas en dos artículos gemelos.
 *  4. El mismo nombre en otra categoría o subcategoría sí se guarda: son dos
 *     productos distintos (ticket b4afccf5).
 *  5. Renombrar —o mover de categoría— tampoco puede acabar en dos artículos
 *     iguales dentro del mismo bloque.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { columnaSubgrupo } from "@/lib/cierre-turno/objetivos";

const sesion = {
  user: { id: "u_owner", rol: "OWNER", tiendaId: null as string | null, name: "Owner" },
};

type ArticuloFila = {
  id: string;
  nombre: string;
  categoria?: string | null;
  subcategoria?: string | null;
  activo: boolean;
  orden: number;
};

let existentes: ArticuloFila[] = [];
let objetivosDelMes: {
  articuloId: string | null;
  categoria: string | null;
  subcategoria: string | null;
}[] = [];

const prismaMock = {
  articuloVenta: {
    findMany: vi.fn(async () => existentes),
    // El PATCH mira cómo queda el artículo entero antes de guardar: necesita
    // el que se está tocando, además del resto del catálogo.
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const a = existentes.find((x) => x.id === where.id);
      return a ?? { nombre: "Pospago", categoria: null, subcategoria: null };
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "art_nuevo",
      activo: true,
      precio: null,
      ...data,
    })),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
      id: where.id,
      categoria: null,
      orden: 0,
      activo: true,
      precio: null,
      nombre: "Pospago",
      ...data,
    })),
  },
  // Objetivos del mes: lo que el GET con ?todos=1 usa para el distintivo de
  // cómo se evalúa cada producto.
  objetivoVenta: { findMany: vi.fn(async () => objetivosDelMes) },
  configuracionEmpresa: { findUnique: vi.fn(async () => ({ ventasPreciosActivos: false })) },
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

async function post(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const { NextRequest } = await import("next/server");
  return POST(
    new NextRequest("http://acme.localhost:3000/api/articulos-venta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function patch(body: Record<string, unknown>) {
  const { PATCH } = await import("./route");
  const { NextRequest } = await import("next/server");
  return PATCH(
    new NextRequest("http://acme.localhost:3000/api/articulos-venta", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  existentes = [];
  objetivosDelMes = [];
  sesion.user = { id: "u_owner", rol: "OWNER", tiendaId: null, name: "Owner" };
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("POST /api/articulos-venta", () => {
  it("un comercial no toca el catálogo", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
    const res = await post({ nombre: "Pospago" });
    expect(res.status).toBe(403);
  });

  it("el coordinador tampoco", async () => {
    sesion.user = { id: "u_jefe", rol: "MANAGER", tiendaId: "t1", name: "Jefe" };
    const res = await post({ nombre: "Pospago" });
    expect(res.status).toBe(403);
  });

  it("crea el artículo al final de la lista", async () => {
    existentes = [{ id: "art_1", nombre: "Fibra", activo: true, orden: 4 }];
    const res = await post({ nombre: "  Pospago  ", categoria: " Telefonía " });
    expect(res.status).toBe(201);
    expect(prismaMock.articuloVenta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          nombre: "Pospago",
          categoria: "Telefonía",
          subcategoria: null,
          orden: 5,
          precio: null,
        },
      }),
    );
  });

  it("guarda la subcategoría con las mismas reglas que la categoría", async () => {
    const res = await post({
      nombre: "Pospago 20GB",
      categoria: " Telefonía ",
      subcategoria: "  Móvil   pospago ",
    });
    expect(res.status).toBe(201);
    expect(prismaMock.articuloVenta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ categoria: "Telefonía", subcategoria: "Móvil pospago" }),
      }),
    );
  });

  it("con el catálogo vacío, el primero va en la posición 0", async () => {
    const res = await post({ nombre: "Pospago" });
    expect(res.status).toBe(201);
    expect(prismaMock.articuloVenta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { nombre: "Pospago", categoria: null, subcategoria: null, orden: 0, precio: null },
      }),
    );
  });

  it("guarda el precio en formato español", async () => {
    const res = await post({ nombre: "Energía", precio: "29,90" });
    expect(res.status).toBe(201);
    expect(prismaMock.articuloVenta.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ precio: 29.9 }) }),
    );
  });

  it("no duplica un artículo que ya está, aunque cambien tildes y mayúsculas", async () => {
    existentes = [{ id: "art_1", nombre: "Energía", activo: true, orden: 0 }];
    const res = await post({ nombre: "ENERGIA" });
    expect(res.status).toBe(409);
    expect(prismaMock.articuloVenta.create).not.toHaveBeenCalled();
  });

  it("tampoco si repite nombre dentro de la misma categoría", async () => {
    existentes = [
      { id: "art_1", nombre: "Renove", categoria: "Telefonía", subcategoria: null, activo: true, orden: 0 },
    ];
    const res = await post({ nombre: "renove", categoria: " TELEFONIA " });
    expect(res.status).toBe(409);
    expect(prismaMock.articuloVenta.create).not.toHaveBeenCalled();
  });

  it("el mismo nombre en otra categoría sí se crea: son dos productos", async () => {
    existentes = [
      { id: "art_1", nombre: "Renove", categoria: "Telefonía", subcategoria: null, activo: true, orden: 0 },
    ];
    const res = await post({ nombre: "Renove", categoria: "Energía" });
    expect(res.status).toBe(201);
    expect(prismaMock.articuloVenta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nombre: "Renove", categoria: "Energía", orden: 1 }),
      }),
    );
  });

  it("y el mismo nombre y categoría en otra subcategoría, también", async () => {
    existentes = [
      {
        id: "art_1",
        nombre: "Renove",
        categoria: "Telefonía",
        subcategoria: "Pospago",
        activo: true,
        orden: 0,
      },
    ];
    const res = await post({ nombre: "Renove", categoria: "Telefonía", subcategoria: "Prepago" });
    expect(res.status).toBe(201);
    expect(prismaMock.articuloVenta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subcategoria: "Prepago" }),
      }),
    );
  });

  it("solo reactiva el desactivado que está en esa misma categoría", async () => {
    existentes = [
      { id: "art_1", nombre: "Renove", categoria: "Telefonía", subcategoria: null, activo: false, orden: 2 },
    ];
    const res = await post({ nombre: "Renove", categoria: "Energía" });
    expect(res.status).toBe(201);
    expect(prismaMock.articuloVenta.update).not.toHaveBeenCalled();
    expect(prismaMock.articuloVenta.create).toHaveBeenCalled();
  });

  it("si el artículo estaba desactivado, lo reactiva en vez de clonarlo", async () => {
    existentes = [
      { id: "art_1", nombre: "Renove", categoria: "Terminales", subcategoria: null, activo: false, orden: 2 },
    ];
    const res = await post({ nombre: "renove", categoria: "terminales" });
    expect(res.status).toBe(201);
    expect(prismaMock.articuloVenta.create).not.toHaveBeenCalled();
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "art_1" },
        data: { nombre: "renove", categoria: "terminales", subcategoria: null, activo: true },
      }),
    );
    expect(await res.json()).toMatchObject({ reactivado: true });
  });

  it("rechaza un nombre que no es un nombre", async () => {
    expect((await post({ nombre: "" })).status).toBe(400);
    expect((await post({ nombre: "x" })).status).toBe(400);
    expect(prismaMock.articuloVenta.create).not.toHaveBeenCalled();
  });

  it("rechaza un precio que no es un precio", async () => {
    const res = await post({ nombre: "Prepago", precio: "consultar" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/articulos-venta", () => {
  it("renombrar a un nombre ya usado se rechaza", async () => {
    existentes = [
      { id: "art_1", nombre: "Pospago", activo: true, orden: 0 },
      { id: "art_2", nombre: "Prepago", activo: true, orden: 1 },
    ];
    // El handler excluye el propio id en el where; el mock devuelve la lista
    // entera, así que se filtra aquí para reproducir esa consulta.
    prismaMock.articuloVenta.findMany.mockResolvedValueOnce(
      existentes.filter((a) => a.id !== "art_2"),
    );
    const res = await patch({ id: "art_2", nombre: "pospago" });
    expect(res.status).toBe(409);
    expect(prismaMock.articuloVenta.update).not.toHaveBeenCalled();
  });

  it("renombrar de verdad sí guarda, con los espacios colapsados", async () => {
    existentes = [{ id: "art_1", nombre: "Pospago", activo: true, orden: 0 }];
    prismaMock.articuloVenta.findMany.mockResolvedValueOnce([]);
    const res = await patch({ id: "art_1", nombre: "  Pospago   nuevo " });
    expect(res.status).toBe(200);
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "art_1" },
        data: { nombre: "Pospago nuevo" },
      }),
    );
  });

  it("renombrar a un nombre que ya existe en otra categoría sí se guarda", async () => {
    existentes = [
      { id: "art_1", nombre: "Renove", categoria: "Telefonía", subcategoria: null, activo: true, orden: 0 },
      { id: "art_2", nombre: "Alta", categoria: "Energía", subcategoria: null, activo: true, orden: 1 },
    ];
    prismaMock.articuloVenta.findMany.mockResolvedValueOnce(
      existentes.filter((a) => a.id !== "art_2"),
    );
    const res = await patch({ id: "art_2", nombre: "Renove" });
    expect(res.status).toBe(200);
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "art_2" }, data: { nombre: "Renove" } }),
    );
  });

  it("mover un artículo a una categoría donde ya hay otro igual se rechaza", async () => {
    existentes = [
      { id: "art_1", nombre: "Renove", categoria: "Telefonía", subcategoria: null, activo: true, orden: 0 },
      { id: "art_2", nombre: "Renove", categoria: "Energía", subcategoria: null, activo: true, orden: 1 },
    ];
    prismaMock.articuloVenta.findMany.mockResolvedValueOnce(
      existentes.filter((a) => a.id !== "art_2"),
    );
    const res = await patch({ id: "art_2", categoria: "Telefonía" });
    expect(res.status).toBe(409);
    expect(prismaMock.articuloVenta.update).not.toHaveBeenCalled();
  });

  it("vaciar la categoría la deja sin categoría, no en blanco", async () => {
    const res = await patch({ id: "art_1", categoria: "  " });
    expect(res.status).toBe(200);
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { categoria: null } }),
    );
  });

  it("mover un artículo de subcategoría guarda solo ese campo", async () => {
    const res = await patch({ id: "art_1", subcategoria: " Móvil " });
    expect(res.status).toBe(200);
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { subcategoria: "Móvil" } }),
    );
  });

  it("vaciar la subcategoría la saca del subgrupo, no la deja en blanco", async () => {
    const res = await patch({ id: "art_1", subcategoria: "" });
    expect(res.status).toBe(200);
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { subcategoria: null } }),
    );
  });
});

async function get(query = "") {
  const { GET } = await import("./route");
  const { NextRequest } = await import("next/server");
  return GET(new NextRequest(`http://acme.localhost:3000/api/articulos-venta${query}`));
}

describe("GET /api/articulos-venta?todos=1 — el distintivo de cómo se evalúa", () => {
  it("dice sobre qué productos y sobre qué subcategorías hay objetivo este mes", async () => {
    existentes = [
      { id: "art_1", nombre: "Pospago", categoria: "Telefonía", subcategoria: "Móvil", activo: true, orden: 0 },
    ];
    objetivosDelMes = [
      { articuloId: "art_1", categoria: null, subcategoria: null },
      // El grupo con objetivo es la subcategoría, con su categoría delante:
      // "Móvil" de Telefonía y "Móvil" de Energía son dos grupos.
      { articuloId: null, categoria: "Telefonía", subcategoria: "Móvil" },
    ];
    const res = await get("?todos=1");
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      objetivosDelMes: { articuloIds: string[]; subgrupos: string[] };
    };
    expect(data.objetivosDelMes.articuloIds).toEqual(["art_1"]);
    expect(data.objetivosDelMes.subgrupos).toEqual([
      columnaSubgrupo({ subcategoria: "Móvil" }),
    ]);
  });

  it("sin ?todos=1 no se consultan los objetivos ni se manda la clave", async () => {
    const res = await get();
    const data = (await res.json()) as { objetivosDelMes?: unknown };
    expect(data.objetivosDelMes).toBeUndefined();
    expect(prismaMock.objetivoVenta.findMany).not.toHaveBeenCalled();
  });
});
