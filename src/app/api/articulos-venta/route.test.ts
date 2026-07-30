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
 *  3. El mismo nombre no se duplica ni cambiando tildes o mayúsculas; si el que
 *     había estaba desactivado se reactiva, para no partir el histórico de
 *     ventas en dos artículos gemelos.
 *  4. Renombrar tampoco puede acabar en dos artículos con el mismo nombre.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_owner", rol: "OWNER", tiendaId: null as string | null, name: "Owner" },
};

type ArticuloFila = {
  id: string;
  nombre: string;
  categoria?: string | null;
  activo: boolean;
  orden: number;
};

let existentes: ArticuloFila[] = [];

const prismaMock = {
  articuloVenta: {
    findMany: vi.fn(async () => existentes),
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
        data: { nombre: "Pospago", categoria: "Telefonía", orden: 5, precio: null },
      }),
    );
  });

  it("con el catálogo vacío, el primero va en la posición 0", async () => {
    const res = await post({ nombre: "Pospago" });
    expect(res.status).toBe(201);
    expect(prismaMock.articuloVenta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { nombre: "Pospago", categoria: null, orden: 0, precio: null },
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

  it("si el artículo estaba desactivado, lo reactiva en vez de clonarlo", async () => {
    existentes = [{ id: "art_1", nombre: "Renove", activo: false, orden: 2 }];
    const res = await post({ nombre: "renove", categoria: "Terminales" });
    expect(res.status).toBe(201);
    expect(prismaMock.articuloVenta.create).not.toHaveBeenCalled();
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "art_1" },
        data: { nombre: "renove", categoria: "Terminales", activo: true },
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

  it("vaciar la categoría la deja sin categoría, no en blanco", async () => {
    const res = await patch({ id: "art_1", categoria: "  " });
    expect(res.status).toBe(200);
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { categoria: null } }),
    );
  });
});
