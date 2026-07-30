/**
 * /api/objetivos-venta — permisos y guardado.
 *
 * Se invoca al handler directamente con un NextRequest (sin levantar HTTP) y
 * con Prisma mockeado, como en `src/app/api/fichajes/checklist.test.ts`.
 *
 * Lo que se protege aquí:
 *  1. Un comercial no entra: los objetivos son de administración y coordinación.
 *  2. El coordinador ve su sede y en modo lectura, aunque pida otra sede.
 *  3. Fijar un objetivo NO usa `upsert` sobre la clave única con NULLs (en
 *     Postgres dos NULL no son iguales y crearía duplicados): busca primero.
 *  4. Cantidad 0 borra el objetivo en vez de dejar un cero que parece un
 *     objetivo real de cero unidades.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_owner", rol: "OWNER", tiendaId: null as string | null, name: "Owner" },
};

const objetivosExistentes: {
  id: string;
  mes: string;
  userId: string | null;
  tiendaId: string | null;
  articuloId: string | null;
  cantidad: number;
}[] = [];

const prismaMock = {
  objetivoVenta: {
    findMany: vi.fn(async () => objetivosExistentes),
    findFirst: vi.fn(async () => null as unknown),
    findUnique: vi.fn(async () => null as unknown),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "obj_nuevo", ...data })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "obj_1", ...data })),
    delete: vi.fn(async () => ({ id: "obj_1" })),
  },
  cierreTurno: { findMany: vi.fn(async () => [] as unknown[]) },
  cierreTurnoVenta: { groupBy: vi.fn(async () => [] as unknown[]) },
  articuloVenta: {
    findMany: vi.fn(async () => [{ id: "art_fibra", nombre: "Alta de fibra", categoria: null, precio: null }]),
    findUnique: vi.fn(async () => ({ id: "art_fibra" })),
  },
  tienda: {
    findMany: vi.fn(async () => [{ id: "t1", nombre: "Centro" }]),
    findUnique: vi.fn(async () => ({ id: "t1" })),
  },
  user: {
    findMany: vi.fn(async () => [
      { id: "u_ana", nombre: "Ana", apellidos: "García", tiendaId: "t1" },
    ]),
    findUnique: vi.fn(async () => ({ id: "u_ana" })),
  },
  configuracionEmpresa: { findUnique: vi.fn(async () => ({ ventasPreciosActivos: false })) },
  // La transacción se ejecuta con el propio mock: lo que interesa es qué
  // llamadas hace el handler dentro.
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

async function get(query = "") {
  const { GET } = await import("./route");
  const { NextRequest } = await import("next/server");
  return GET(new NextRequest(`http://acme.localhost:3000/api/objetivos-venta${query}`));
}

async function put(body: Record<string, unknown>) {
  const { PUT } = await import("./route");
  const { NextRequest } = await import("next/server");
  return PUT(
    new NextRequest("http://acme.localhost:3000/api/objetivos-venta", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  objetivosExistentes.length = 0;
  sesion.user = { id: "u_owner", rol: "OWNER", tiendaId: null, name: "Owner" };
  prismaMock.objetivoVenta.findFirst.mockResolvedValue(null);
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("GET /api/objetivos-venta", () => {
  it("un comercial no consulta los objetivos de nadie", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
    const res = await get();
    expect(res.status).toBe(403);
  });

  it("el coordinador entra en modo lectura y atado a su sede", async () => {
    sesion.user = { id: "u_jefe", rol: "MANAGER", tiendaId: "t1", name: "Jefe" };
    const res = await get("?tiendaId=t9");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { soloLectura: boolean };
    expect(data.soloLectura).toBe(true);
    // Pidió la sede t9 y se le sirve la suya.
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tiendaId: "t1" }) }),
    );
  });

  it("administración puede escribir", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { soloLectura: boolean; mes: string };
    expect(data.soloLectura).toBe(false);
    expect(data.mes).toMatch(/^\d{4}-\d{2}$/);
  });

  it("rechaza un mes con formato inventado", async () => {
    const res = await get("?mes=julio");
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/objetivos-venta", () => {
  it("el coordinador no puede fijar objetivos", async () => {
    sesion.user = { id: "u_jefe", rol: "MANAGER", tiendaId: "t1", name: "Jefe" };
    const res = await put({ mes: "2026-07", ambito: "comercial", sujetoId: "u_ana", cantidad: 10 });
    expect(res.status).toBe(403);
  });

  it("crea el objetivo buscándolo primero, no con upsert", async () => {
    const res = await put({ mes: "2026-07", ambito: "comercial", sujetoId: "u_ana", cantidad: 10 });
    expect(res.status).toBe(200);
    expect(prismaMock.objetivoVenta.findFirst).toHaveBeenCalledWith({
      where: { mes: "2026-07", userId: "u_ana", tiendaId: null, articuloId: null },
      select: { id: true },
    });
    expect(prismaMock.objetivoVenta.create).toHaveBeenCalledWith({
      data: { mes: "2026-07", userId: "u_ana", tiendaId: null, articuloId: null, cantidad: 10 },
      select: { id: true, cantidad: true },
    });
  });

  it("si ya existía, lo actualiza en vez de duplicarlo", async () => {
    prismaMock.objetivoVenta.findFirst.mockResolvedValue({ id: "obj_1" });
    const res = await put({ mes: "2026-07", ambito: "sede", sujetoId: "t1", cantidad: 40 });
    expect(res.status).toBe(200);
    expect(prismaMock.objetivoVenta.create).not.toHaveBeenCalled();
    expect(prismaMock.objetivoVenta.update).toHaveBeenCalledWith({
      where: { id: "obj_1" },
      data: { cantidad: 40 },
      select: { id: true, cantidad: true },
    });
  });

  it("cantidad 0 quita el objetivo", async () => {
    prismaMock.objetivoVenta.findFirst.mockResolvedValue({ id: "obj_1" });
    const res = await put({ mes: "2026-07", ambito: "comercial", sujetoId: "u_ana", cantidad: 0 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ borrado: true });
    expect(prismaMock.objetivoVenta.delete).toHaveBeenCalledWith({ where: { id: "obj_1" } });
  });

  it("un objetivo de alguien que no existe se rechaza", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as unknown as { id: string });
    const res = await put({ mes: "2026-07", ambito: "comercial", sujetoId: "fantasma", cantidad: 5 });
    expect(res.status).toBe(404);
  });

  it("rechaza cantidades que no son unidades enteras", async () => {
    const res = await put({ mes: "2026-07", ambito: "comercial", sujetoId: "u_ana", cantidad: -3 });
    expect(res.status).toBe(400);
  });
});
