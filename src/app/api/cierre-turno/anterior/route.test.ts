/**
 * GET /api/cierre-turno/anterior — lo que le deja el turno anterior.
 *
 * Lo que protege (ticket 2e6b91f4):
 *  1. Se acota a SUS sedes, nunca al id que venga del cliente.
 *  2. No devuelve el cierre de hoy ni el suyo: "el turno anterior" es lo que le
 *     dejaron, no lo que está pasando ahora ni lo que hizo él.
 *  3. Sale la caja con sus adjuntos (el Excel del stock y el TPV) por id, sin el
 *     contenido: son cientos de KB por fichero.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1" as string | null, name: "Ana" },
};

const CIERRE = {
  id: "c_luis",
  fecha: new Date("2026-07-30T00:00:00Z"),
  incidencia: "El datáfono se reinició dos veces",
  completadoEn: new Date("2026-07-30T21:00:00Z"),
  user: { nombre: "Luis", apellidos: "Pérez" },
  tienda: { id: "t1", nombre: "NEKSUS CARTAGENA" },
  caja: {
    efectivo: 320.5,
    tarjeta: 1200,
    confirmadoEn: null,
    adjuntos: [
      { id: "adj_stock", tipo: "stock", nombre: "stock.xlsx", mime: "application/vnd.ms-excel" },
      { id: "adj_tpv", tipo: "tpv", nombre: "tpv.jpg", mime: "image/jpeg" },
    ],
  },
};

const prismaMock = {
  cierreTurno: { findFirst: vi.fn(async () => CIERRE as unknown) },
  usuarioSede: { findMany: vi.fn(async () => [{ tiendaId: "t2", principal: false }]) },
  tienda: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })) },
};

vi.mock("@/lib/prisma", () => ({
  prismaApp: prismaMock,
  prismaMaster: {},
  prismaRuntime: {},
  prismaQuotaWriter: {},
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sesion) }));

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
  const res = await GET(
    new NextRequest(`http://acme.localhost:3000/api/cierre-turno/anterior${query}`),
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  vi.clearAllMocks();
  sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
  prismaMock.cierreTurno.findFirst.mockResolvedValue(CIERRE);
  prismaMock.usuarioSede.findMany.mockResolvedValue([{ tiendaId: "t2", principal: false }]);
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("GET /api/cierre-turno/anterior", () => {
  it("devuelve la caja y los adjuntos del último cierre de su sede", async () => {
    const { body } = await get();
    expect(body.cierre).toMatchObject({
      quien: "Luis Pérez",
      sede: "NEKSUS CARTAGENA",
      fecha: "2026-07-30",
      incidencia: "El datáfono se reinició dos veces",
    });
    expect(body.cierre.caja).toMatchObject({ efectivo: 320.5, tarjeta: 1200, confirmada: false });
    expect(body.cierre.caja.adjuntos.map((a: { tipo: string }) => a.tipo)).toEqual([
      "stock",
      "tpv",
    ]);
  });

  it("busca en SUS sedes, ni el de hoy ni el suyo", async () => {
    await get();
    const [args] = prismaMock.cierreTurno.findFirst.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).toMatchObject({
      tiendaId: { in: ["t1", "t2"] },
      userId: { not: "u_ana" },
    });
    // Y con tope de fecha: el cierre de hoy no cuenta.
    expect(args.where.fecha).toHaveProperty("lt");
  });

  it("una sede que no es suya se ignora: se le sirven las suyas", async () => {
    await get("?tiendaId=t9");
    const [args] = prismaMock.cierreTurno.findFirst.mock.calls[0] as unknown as [
      { where: { tiendaId: { in: string[] } } },
    ];
    expect(args.where.tiendaId.in).toEqual(["t1", "t2"]);
  });

  it("puede pedir una de sus sedes: quien cubre en varias necesita la de hoy", async () => {
    await get("?tiendaId=t2");
    const [args] = prismaMock.cierreTurno.findFirst.mock.calls[0] as unknown as [
      { where: { tiendaId: { in: string[] } } },
    ];
    expect(args.where.tiendaId.in).toEqual(["t2"]);
  });

  it("sin sede asignada lo dice, en vez de mirar toda la empresa", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: null, name: "Ana" };
    prismaMock.usuarioSede.findMany.mockResolvedValue([]);
    const { body } = await get();
    expect(body).toEqual({ cierre: null, motivo: "sin_sede" });
    expect(prismaMock.cierreTurno.findFirst).not.toHaveBeenCalled();
  });

  it("sin cierres previos devuelve null y por qué", async () => {
    prismaMock.cierreTurno.findFirst.mockResolvedValue(null);
    const { body } = await get();
    expect(body).toEqual({ cierre: null, motivo: "sin_cierres" });
  });
});
