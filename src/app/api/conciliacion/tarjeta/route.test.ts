/**
 * GET /api/conciliacion/tarjeta — el cuadre día a día (ticket 1e73c9a4).
 *
 * Lo que protege: que el extracto se pida DESPLAZADO. Los cobros del datáfono
 * entran en el banco al día siguiente, así que pedir el mismo rango dejaría
 * fuera el ingreso del último día y marcaría un descuadre que no existe.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = { user: { id: "u_own", rol: "OWNER", tiendaId: null, name: "Owner" } };

const prismaMock = {
  tienda: { findUnique: vi.fn(async () => ({ id: "t1", nombre: "NEKSUS CARTAGENA" })) },
  cierreCaja: {
    groupBy: vi.fn(async () => [
      { fecha: new Date("2026-08-01T00:00:00Z"), _sum: { tarjeta: 1210 } },
      { fecha: new Date("2026-08-02T00:00:00Z"), _sum: { tarjeta: 300 } },
    ]),
  },
  movimientoBanco: {
    findMany: vi.fn(async () => [
      // El ingreso de las ventas del 1 llega el 2.
      {
        id: "m1",
        fecha: new Date("2026-08-02T00:00:00Z"),
        importe: 1210,
        concepto: "LIQUIDACION TPV",
        referencia: "REF1",
      },
      // Y el de las del 2, el 3.
      {
        id: "m2",
        fecha: new Date("2026-08-03T00:00:00Z"),
        importe: 250,
        concepto: "LIQUIDACION TPV",
        referencia: "REF2",
      },
    ]),
  },
  configuracionEmpresa: { findUnique: vi.fn(async () => ({ umbralDescuadreEur: 1 })) },
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

interface Fila {
  fecha: string;
  fechaBanco: string;
  declarado: number;
  banco: number;
  diferencia: number;
  descuadre: boolean;
}

async function get(query: string) {
  const { GET } = await import("./route");
  const { NextRequest } = await import("next/server");
  const res = await GET(
    new NextRequest(`http://acme.localhost:3000/api/conciliacion/tarjeta${query}`),
  );
  return {
    status: res.status,
    data: (await res.json()) as {
      filas: Fila[];
      desfase: number;
      sinExtracto: boolean;
      totales: { descuadres: number };
    },
  };
}

const RANGO = "?tiendaId=t1&desde=2026-08-01&hasta=2026-08-02";

beforeEach(async () => {
  vi.clearAllMocks();
  sesion.user = { id: "u_own", rol: "OWNER", tiendaId: null, name: "Owner" };
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("GET /api/conciliacion/tarjeta", () => {
  it("cada día de venta se compara con el ingreso del día siguiente", async () => {
    const { status, data } = await get(RANGO);
    expect(status).toBe(200);
    expect(data.desfase).toBe(1);
    const dia1 = data.filas.find((f) => f.fecha === "2026-08-01")!;
    expect(dia1.fechaBanco).toBe("2026-08-02");
    expect(dia1.declarado).toBe(1210);
    expect(dia1.banco).toBe(1210);
    expect(dia1.descuadre).toBe(false);
  });

  it("el extracto se pide desplazado, no en el mismo rango", async () => {
    // Si se pidiera el rango tal cual, el ingreso del último día (que llega
    // después) se quedaría fuera y ese día saldría descuadrado sin motivo.
    await get(RANGO);
    const [args] = prismaMock.movimientoBanco.findMany.mock.calls[0] as unknown as [
      { where: { fecha: { gte: Date; lt: Date } } },
    ];
    expect(args.where.fecha.gte.toISOString().slice(0, 10)).toBe("2026-08-02");
    // `lt` es exclusivo: cubre todo el día 3.
    expect(args.where.fecha.lt.toISOString().slice(0, 10)).toBe("2026-08-04");
  });

  it("una diferencia real se marca", async () => {
    const { data } = await get(RANGO);
    // El día 2 declaró 300 y el banco ingresó 250.
    const dia2 = data.filas.find((f) => f.fecha === "2026-08-02")!;
    expect(dia2.diferencia).toBe(-50);
    expect(dia2.descuadre).toBe(true);
    expect(data.totales.descuadres).toBe(1);
  });

  it("se puede pedir otro desfase para un banco que liquide distinto", async () => {
    const { data } = await get(`${RANGO}&desfase=2`);
    expect(data.desfase).toBe(2);
    expect(data.filas.find((f) => f.fecha === "2026-08-01")?.fechaBanco).toBe("2026-08-03");
  });

  it("un desfase absurdo se ignora y se usa el de siempre", async () => {
    expect((await get(`${RANGO}&desfase=99`)).data.desfase).toBe(1);
    expect((await get(`${RANGO}&desfase=-3`)).data.desfase).toBe(1);
  });

  it("sin extracto importado se dice, en vez de pintarlo todo como que falta dinero", async () => {
    prismaMock.movimientoBanco.findMany.mockResolvedValue([]);
    const { data } = await get(RANGO);
    expect(data.sinExtracto).toBe(true);
  });

  it("esto no lo ve un empleado ni un coordinador", async () => {
    sesion.user = { id: "u_ana", rol: "MANAGER", tiendaId: "t1", name: "Ana" };
    expect((await get(RANGO)).status).toBe(403);
  });

  it("sin rango de fechas no se consulta nada", async () => {
    expect((await get("?tiendaId=t1")).status).toBe(400);
  });
});
