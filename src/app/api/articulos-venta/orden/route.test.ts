/**
 * /api/articulos-venta/orden — recolocar el catálogo ya dado de alta.
 *
 * Se invoca al handler directamente con un NextRequest (sin levantar HTTP) y
 * con Prisma mockeado, igual que `src/app/api/articulos-venta/route.test.ts`.
 *
 * Lo que se protege aquí:
 *  1. Solo administración recoloca el catálogo.
 *  2. El orden se reescribe 0..n-1, así que dos artículos nunca comparten
 *     posición (que es lo que hacía saltar la tabla entre recargas).
 *  3. Una lista que ya no es el catálogo que hay se rechaza con 409 en vez de
 *     guardar posiciones a medias.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_owner", rol: "OWNER", tiendaId: null as string | null, name: "Owner" },
};

let existentes: { id: string; orden: number }[] = [];

const prismaMock = {
  articuloVenta: {
    findMany: vi.fn(async () => existentes),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
      id: where.id,
      ...data,
    })),
  },
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

async function put(body: Record<string, unknown>) {
  const { PUT } = await import("./route");
  const { NextRequest } = await import("next/server");
  return PUT(
    new NextRequest("http://acme.localhost:3000/api/articulos-venta/orden", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  existentes = [
    { id: "art_1", orden: 0 },
    { id: "art_2", orden: 1 },
    { id: "art_3", orden: 2 },
  ];
  sesion.user = { id: "u_owner", rol: "OWNER", tiendaId: null, name: "Owner" };
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("PUT /api/articulos-venta/orden", () => {
  it("un comercial no recoloca el catálogo", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
    const res = await put({ ids: ["art_3", "art_1", "art_2"] });
    expect(res.status).toBe(403);
    expect(prismaMock.articuloVenta.update).not.toHaveBeenCalled();
  });

  it("guarda el nuevo orden y solo toca lo que cambia de sitio", async () => {
    const res = await put({ ids: ["art_1", "art_3", "art_2"] });
    expect(res.status).toBe(200);
    // art_1 se queda en la posición 0: no hace falta escribirlo.
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledWith({
      where: { id: "art_3" },
      data: { orden: 1 },
    });
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledWith({
      where: { id: "art_2" },
      data: { orden: 2 },
    });
  });

  it("normaliza posiciones repetidas del catálogo viejo", async () => {
    // Catálogos anteriores a esta pantalla podían tener todo en orden 0: la
    // tabla salía ordenada por nombre y cambiaba de sitio sin motivo.
    existentes = [
      { id: "art_1", orden: 0 },
      { id: "art_2", orden: 0 },
      { id: "art_3", orden: 0 },
    ];
    const res = await put({ ids: ["art_2", "art_3", "art_1"] });
    expect(res.status).toBe(200);
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledWith({
      where: { id: "art_3" },
      data: { orden: 1 },
    });
    expect(prismaMock.articuloVenta.update).toHaveBeenCalledWith({
      where: { id: "art_1" },
      data: { orden: 2 },
    });
  });

  it("si la lista no es el catálogo que hay, no guarda nada", async () => {
    const res = await put({ ids: ["art_1", "art_2"] });
    expect(res.status).toBe(409);
    expect(prismaMock.articuloVenta.update).not.toHaveBeenCalled();
  });

  it("rechaza una lista que no son ids", async () => {
    const res = await put({ ids: "art_1,art_2,art_3" });
    expect(res.status).toBe(400);
    expect(prismaMock.articuloVenta.update).not.toHaveBeenCalled();
  });
});
