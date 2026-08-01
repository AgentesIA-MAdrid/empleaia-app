/**
 * POST /api/cierre-turno/confirmar — cerrar el turno.
 *
 * Lo que protege (ticket 3b7e05d1): quien cierra la tienda el domingo no puede
 * cerrar su turno sin haber declarado el arqueo de la semana. Se comprueba en el
 * servidor y no solo en la pantalla, que es donde de verdad se decide.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = { user: { id: "u_tarde", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" } };

/** El domingo 2 de agosto de 2026. */
const DOMINGO = "2026-08-02";

const cierre = {
  id: "c1",
  completadoEn: null as Date | null,
  tiendaId: "t1" as string | null,
  user: { id: "u_tarde", nombre: "Ana", apellidos: "Ruiz" },
  tienda: { id: "t1", nombre: "NEKSUS CARTAGENA", sinEfectivo: false, esOficina: false },
  caja: { efectivo: 340.5, tarjeta: 0, confirmadoEn: new Date() },
  ventas: [],
};

const prismaMock = {
  cierreTurno: {
    findUnique: vi.fn(async () => cierre as unknown),
    update: vi.fn(async () => ({}) as unknown),
  },
  turno: {
    findMany: vi.fn(async () => [
      { userId: "u_mañana", horaFin: "15:00" },
      { userId: "u_tarde", horaFin: "22:00" },
    ]),
  },
  arqueo: { findUnique: vi.fn(async () => null as { id: string } | null) },
};

vi.mock("@/lib/prisma", () => ({
  prismaApp: prismaMock,
  prismaMaster: {},
  prismaRuntime: {},
  prismaQuotaWriter: {},
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sesion) }));
vi.mock("@/lib/cierre-turno/notify", () => ({ notifyCierreConIncidencia: vi.fn(async () => {}) }));

// El día lo fija el test: la regla del arqueo depende de que sea domingo.
vi.mock("@/lib/cierre-turno/core", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return { ...real, diaMadrid: () => diaActual };
});
let diaActual = DOMINGO;

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

async function cerrar(body: unknown = { hayIncidencia: false }) {
  const { POST } = await import("./route");
  const { NextRequest } = await import("next/server");
  const res = await POST(
    new NextRequest("http://acme.localhost:3000/api/cierre-turno/confirmar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  vi.clearAllMocks();
  diaActual = DOMINGO;
  sesion.user = { id: "u_tarde", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
  cierre.completadoEn = null;
  cierre.tiendaId = "t1";
  cierre.tienda = { id: "t1", nombre: "NEKSUS CARTAGENA", sinEfectivo: false, esOficina: false };
  prismaMock.cierreTurno.findUnique.mockResolvedValue(cierre);
  prismaMock.turno.findMany.mockResolvedValue([
    { userId: "u_mañana", horaFin: "15:00" },
    { userId: "u_tarde", horaFin: "22:00" },
  ]);
  prismaMock.arqueo.findUnique.mockResolvedValue(null);
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("POST /api/cierre-turno/confirmar — el arqueo del domingo", () => {
  it("quien cierra la tienda el domingo no cierra su turno sin arquear", async () => {
    const { status, data } = await cerrar();
    expect(status).toBe(409);
    expect(data.code).toBe("sin_arqueo");
    expect(prismaMock.cierreTurno.update).not.toHaveBeenCalled();
  });

  it("con el arqueo ya declarado, cierra sin más", async () => {
    prismaMock.arqueo.findUnique.mockResolvedValue({ id: "arq1" });
    const { status } = await cerrar();
    expect(status).toBe(200);
    expect(prismaMock.cierreTurno.update).toHaveBeenCalled();
  });

  it("al de la mañana no se le pide: no es quien cierra la tienda", async () => {
    sesion.user = { id: "u_mañana", rol: "EMPLEADO", tiendaId: "t1", name: "Luis" };
    cierre.user = { id: "u_mañana", nombre: "Luis", apellidos: "Gil" };
    const { status } = await cerrar();
    expect(status).toBe(200);
  });

  it("un martes no se pide arqueo a nadie", async () => {
    diaActual = "2026-08-04";
    const { status } = await cerrar();
    expect(status).toBe(200);
  });

  it("en una sede sin efectivo nuestro no hay arqueo que hacer", async () => {
    // Un córner que liquida el centro: el dinero no es nuestro.
    cierre.tienda = { id: "t1", nombre: "NEKSUS ECI POZUELO", sinEfectivo: true, esOficina: false };
    const { status } = await cerrar();
    expect(status).toBe(200);
  });

  it("en la oficina tampoco", async () => {
    cierre.tienda = { id: "t1", nombre: "OFICINA LEGANES", sinEfectivo: false, esOficina: true };
    const { status } = await cerrar();
    expect(status).toBe(200);
  });

  it("sin caja confirmada se para antes, sin llegar al arqueo", async () => {
    prismaMock.cierreTurno.findUnique.mockResolvedValue({
      ...cierre,
      caja: { efectivo: 0, tarjeta: 0, confirmadoEn: null },
    });
    const { status, data } = await cerrar();
    expect(status).toBe(409);
    expect(data.code).toBe("sin_caja");
  });
});
