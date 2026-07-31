/**
 * GET /api/cierre-turno/acceso — a quién se le ofrece el cierre de turno desde
 * la pantalla de fichaje.
 *
 * Lo que protege: que el botón de `/empleado` siga la misma regla que el menú.
 * Si esto se rompe, durante el rodaje el módulo queda escondido en el menú pero
 * ofrecido en la pantalla que más se usa, que es justo lo que el interruptor
 * quería evitar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type Sesion = { user: { id: string; rol: string } } | null;

let sesionActual: Sesion = { user: { id: "u_ana", rol: "EMPLEADO" } };

const prismaMock = {
  configuracionEmpresa: {
    findUnique: vi.fn(async () => ({ cierreTurnoEnRodaje: true }) as unknown),
  },
  user: { findUnique: vi.fn(async () => ({ cierreTurnoPiloto: false }) as unknown) },
  cierreTurno: { findUnique: vi.fn(async () => null as unknown) },
};

vi.mock("@/lib/prisma", () => ({
  prismaApp: prismaMock,
  prismaMaster: {},
  prismaRuntime: {},
  prismaQuotaWriter: {},
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sesionActual) }));

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

async function get() {
  const { GET } = await import("./route");
  const { NextRequest } = await import("next/server");
  return GET(new NextRequest("http://acme.localhost:3000/api/cierre-turno/acceso"));
}

beforeEach(async () => {
  vi.clearAllMocks();
  sesionActual = { user: { id: "u_ana", rol: "EMPLEADO" } };
  prismaMock.configuracionEmpresa.findUnique.mockResolvedValue({ cierreTurnoEnRodaje: true });
  prismaMock.user.findUnique.mockResolvedValue({ cierreTurnoPiloto: false });
  prismaMock.cierreTurno.findUnique.mockResolvedValue(null);
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("GET /api/cierre-turno/acceso", () => {
  it("sin sesión no dice nada", async () => {
    sesionActual = null;
    expect((await get()).status).toBe(401);
  });

  it("en rodaje, a la plantilla no se le ofrece", async () => {
    const data = (await (await get()).json()) as { visible: boolean };
    expect(data.visible).toBe(false);
  });

  it("en rodaje, quien lo estrena sí lo ve", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ cierreTurnoPiloto: true });
    const data = (await (await get()).json()) as { visible: boolean };
    expect(data.visible).toBe(true);
  });

  it("abierto al equipo, lo ve cualquiera", async () => {
    prismaMock.configuracionEmpresa.findUnique.mockResolvedValue({ cierreTurnoEnRodaje: false });
    const data = (await (await get()).json()) as { visible: boolean };
    expect(data.visible).toBe(true);
  });

  it("sin fila de configuración se asume rodaje, que es el lado prudente", async () => {
    prismaMock.configuracionEmpresa.findUnique.mockResolvedValue(null);
    const data = (await (await get()).json()) as { visible: boolean };
    expect(data.visible).toBe(false);
  });

  it("cuenta si el cierre de hoy está empezado o ya cerrado", async () => {
    prismaMock.configuracionEmpresa.findUnique.mockResolvedValue({ cierreTurnoEnRodaje: false });
    prismaMock.cierreTurno.findUnique.mockResolvedValue({ completadoEn: null });
    let data = (await (await get()).json()) as { empezado: boolean; cerrado: boolean };
    expect(data).toMatchObject({ empezado: true, cerrado: false });

    prismaMock.cierreTurno.findUnique.mockResolvedValue({
      completadoEn: new Date("2026-07-30T21:00:00Z"),
    });
    data = (await (await get()).json()) as { empezado: boolean; cerrado: boolean };
    expect(data).toMatchObject({ empezado: true, cerrado: true });
  });
});
