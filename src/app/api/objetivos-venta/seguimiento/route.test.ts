/**
 * /api/objetivos-venta/seguimiento — permisos y alcance.
 *
 * Se invoca al handler directamente con un NextRequest (sin levantar HTTP) y
 * con Prisma mockeado, como en `src/app/api/objetivos-venta/route.test.ts`.
 *
 * Lo que se protege aquí:
 *  1. Un comercial no entra: el seguimiento es de administración y coordinación.
 *  2. El coordinador queda atado a las sedes que lleva aunque pida otra.
 *  3. Las ventas se leen con el alcance de sede y el filtro por comercial se
 *     aplica encima: la tabla de sedes sigue siendo la de la sede entera.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_owner", rol: "OWNER", tiendaId: null as string | null, name: "Owner" },
};

const catalogo = [
  { id: "art_fibra", nombre: "Alta de fibra", categoria: "Telefonía", cuentaParaObjetivos: true },
  { id: "art_funda", nombre: "Funda", categoria: "Accesorios", cuentaParaObjetivos: false },
];

const prismaMock = {
  objetivoVenta: {
    findMany: vi.fn(async () => [
      {
        id: "o1",
        mes: "2026-07",
        userId: "u_ana",
        tiendaId: null,
        articuloId: null,
        categoria: null,
        cantidad: 31,
      },
    ]),
  },
  cierreTurno: {
    findMany: vi.fn(async (_args?: { where?: Record<string, unknown> }) => [] as unknown[]),
  },
  cierreTurnoVenta: { groupBy: vi.fn(async () => [] as unknown[]) },
  articuloVenta: { findMany: vi.fn(async () => catalogo) },
  tienda: {
    findMany: vi.fn(async () => [{ id: "t1", nombre: "Centro" }]),
    // La usa `sedesDelUsuario` para la sede principal de la ficha.
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
  },
  usuarioSede: { findMany: vi.fn(async () => [{ tiendaId: "t2", principal: false }]) },
  user: {
    findMany: vi.fn(async () => [{ id: "u_ana", nombre: "Ana", apellidos: "García", tiendaId: "t1" }]),
  },
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
  return GET(
    new NextRequest(`http://acme.localhost:3000/api/objetivos-venta/seguimiento${query}`),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  sesion.user = { id: "u_owner", rol: "OWNER", tiendaId: null, name: "Owner" };
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("GET /api/objetivos-venta/seguimiento", () => {
  it("un comercial no hace seguimiento de nadie", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
    const res = await get("?mes=2026-07");
    expect(res.status).toBe(403);
  });

  it("devuelve el mes, el día de corte y una fila por comercial", async () => {
    const res = await get("?mes=2026-07&hasta=2026-07-10");
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      mes: string;
      corte: string;
      dias: number;
      filasComerciales: { sujeto: string; objetivo: number | null }[];
      conceptos: { id: string }[];
    };
    expect(data.mes).toBe("2026-07");
    expect(data.dias).toBe(31);
    expect(data.filasComerciales).toHaveLength(1);
    expect(data.filasComerciales[0].objetivo).toBe(31);
    // Unidades totales + el grupo "Telefonía" + el artículo que cuenta. La
    // funda está excluida de objetivos, así que no se puede seguir.
    expect(data.conceptos.map((c) => c.id)).toEqual(["", "cat:Telefonía", "art_fibra"]);
  });

  it("las ventas se leen del día 1 al de corte, no del mes entero", async () => {
    await get("?mes=2026-07&hasta=2026-07-10");
    const args = prismaMock.cierreTurno.findMany.mock.calls[0]?.[0];
    expect(args?.where?.fecha).toEqual({
      gte: new Date("2026-07-01T00:00:00Z"),
      lt: new Date("2026-07-11T00:00:00Z"),
    });
  });

  it("el coordinador queda atado a las sedes que lleva aunque pida otra", async () => {
    sesion.user = { id: "u_jefe", rol: "MANAGER", tiendaId: "t1", name: "Jefe" };
    const res = await get("?mes=2026-07&tiendaId=t9");
    expect(res.status).toBe(200);
    expect(prismaMock.tienda.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["t1", "t2"] } }),
      }),
    );
    // Las ventas se leen con ese mismo alcance de sede.
    expect(prismaMock.cierreTurno.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ tiendaId: { in: ["t1", "t2"] } }],
        }),
      }),
    );
  });

  it("un comercial de fuera del alcance no acota nada", async () => {
    const res = await get("?mes=2026-07&userId=u_de_otra_empresa");
    const data = (await res.json()) as { filtros: { userId: string | null } };
    expect(data.filtros.userId).toBeNull();
  });

  it("el filtro por comercial no se lleva a la consulta de ventas de la sede", async () => {
    const res = await get("?mes=2026-07&userId=u_ana");
    expect(res.status).toBe(200);
    // El where de cierres no lleva userId: la tabla de sedes tiene que seguir
    // enseñando la sede entera.
    const args = prismaMock.cierreTurno.findMany.mock.calls[0]?.[0];
    expect(args?.where).not.toHaveProperty("userId");
  });
});
