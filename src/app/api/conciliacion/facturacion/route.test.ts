/**
 * GET /api/conciliacion/facturacion — lo declarado frente a lo facturado en el
 * sistema del operador (ticket 4b8e1d05).
 *
 * Dos diferencias con el cuadre del banco, y las dos importan:
 *  1. Se compara lo cobrado ENTERO (efectivo + tarjeta): al operador se le
 *     factura la venta, no el medio de pago.
 *  2. El desfase por defecto es 0 —la venta se factura cuando se hace—, no 1.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_own", rol: "OWNER", tiendaId: null as string | null, name: "Owner" },
};

const prismaMock = {
  tienda: { findUnique: vi.fn(async () => ({ id: "t1", nombre: "NEKSUS CARTAGENA" })) },
  cierreCaja: {
    groupBy: vi.fn(async () => [
      { fecha: new Date("2026-08-01T00:00:00Z"), _sum: { efectivo: 340, tarjeta: 1210 } },
      { fecha: new Date("2026-08-02T00:00:00Z"), _sum: { efectivo: 0, tarjeta: 300 } },
    ]),
  },
  movimientoFacturacion: {
    findMany: vi.fn(async () => [
      // Lo facturado del día 1: cuadra con los 340 + 1210 cobrados.
      {
        id: "f1",
        fecha: new Date("2026-08-01T00:00:00Z"),
        importe: 1550,
        concepto: "ALTAS FIBRA",
        referencia: "FAC1",
      },
      // Del día 2 se declararon 300 pero solo constan 250 facturados.
      {
        id: "f2",
        fecha: new Date("2026-08-02T00:00:00Z"),
        importe: 250,
        concepto: "ALTAS MOVIL",
        referencia: "FAC2",
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
    new NextRequest(`http://acme.localhost:3000/api/conciliacion/facturacion${query}`),
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

describe("GET /api/conciliacion/facturacion", () => {
  it("compara lo cobrado ENTERO, no solo la tarjeta", async () => {
    const { status, data } = await get(RANGO);
    expect(status).toBe(200);
    const dia1 = data.filas.find((f) => f.fecha === "2026-08-01")!;
    // 340 en efectivo + 1210 con tarjeta = 1550, que es lo facturado.
    expect(dia1.declarado).toBe(1550);
    expect(dia1.banco).toBe(1550);
    expect(dia1.descuadre).toBe(false);
  });

  it("por defecto compara el MISMO día, no el siguiente", async () => {
    // Aquí no hay liquidación de por medio: la venta se factura cuando se hace.
    const { data } = await get(RANGO);
    expect(data.desfase).toBe(0);
    expect(data.filas.find((f) => f.fecha === "2026-08-01")?.fechaBanco).toBe("2026-08-01");
  });

  it("una venta declarada que no consta facturada se marca", async () => {
    const { data } = await get(RANGO);
    const dia2 = data.filas.find((f) => f.fecha === "2026-08-02")!;
    // Declaró 300 y solo constan 250 facturados: faltan 50 por tramitar.
    expect(dia2.diferencia).toBe(-50);
    expect(dia2.descuadre).toBe(true);
  });

  it("se puede desplazar si el operador fecha las altas al día siguiente", async () => {
    const { data } = await get(`${RANGO}&desfase=1`);
    expect(data.desfase).toBe(1);
    expect(data.filas.find((f) => f.fecha === "2026-08-01")?.fechaBanco).toBe("2026-08-02");
  });

  it("sin fichero importado se dice, en vez de pintarlo todo como sin facturar", async () => {
    prismaMock.movimientoFacturacion.findMany.mockResolvedValue([]);
    const { data } = await get(RANGO);
    expect(data.sinExtracto).toBe(true);
  });

  it("esto no lo ve un empleado ni un coordinador", async () => {
    sesion.user = { id: "u_ana", rol: "MANAGER", tiendaId: "t1", name: "Ana" };
    expect((await get(RANGO)).status).toBe(403);
  });
});
