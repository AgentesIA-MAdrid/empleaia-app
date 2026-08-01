/**
 * PUT /api/cierre-turno/sede — confirmar el centro de trabajo del día.
 *
 * Lo que protege (ticket 8c05f3e1):
 *  1. La sede elegida se guarda en el cierre de hoy, creándolo si hace falta:
 *     es lo primero que hace el comercial al entrar.
 *  2. Vale cualquier sede ACTIVA, sea "suya" o no: el caso que resuelve esto es
 *     justo el del correturnos que cubre donde no le tocaba.
 *  3. Una sede cerrada o inventada no cuela.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_ana", rol: "EMPLEADO", tiendaId: null as string | null, name: "Ana" },
};

const prismaMock = {
  tienda: {
    findFirst: vi.fn(
      async () =>
        ({ id: "t9", nombre: "YOIGO CC LA VAGUADA", sinEfectivo: false }) as {
          id: string;
          nombre: string;
          sinEfectivo: boolean;
        } | null,
    ),
  },
  cierreTurno: { upsert: vi.fn(async () => ({ id: "c_ana", tiendaId: "t9" })) },
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

async function put(body: unknown) {
  const { PUT } = await import("./route");
  const { NextRequest } = await import("next/server");
  const res = await PUT(
    new NextRequest("http://acme.localhost:3000/api/cierre-turno/sede", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  vi.clearAllMocks();
  sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: null, name: "Ana" };
  prismaMock.tienda.findFirst.mockResolvedValue({
    id: "t9",
    nombre: "YOIGO CC LA VAGUADA",
    sinEfectivo: false,
  });
  prismaMock.cierreTurno.upsert.mockResolvedValue({ id: "c_ana", tiendaId: "t9" });
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("PUT /api/cierre-turno/sede", () => {
  it("guarda la sede en el cierre de hoy, creándolo si no existía", async () => {
    const { status, data } = await put({ tiendaId: "t9" });
    expect(status).toBe(200);
    expect(data.sede).toMatchObject({ id: "t9", nombre: "YOIGO CC LA VAGUADA" });

    const [args] = prismaMock.cierreTurno.upsert.mock.calls[0] as unknown as [
      {
        where: { userId_fecha: { userId: string } };
        create: { tiendaId: string };
        update: { tiendaId: string };
      },
    ];
    expect(args.where.userId_fecha.userId).toBe("u_ana");
    expect(args.create.tiendaId).toBe("t9");
    expect(args.update.tiendaId).toBe("t9");
  });

  it("una sede que no es suya vale: es el caso del correturnos", async () => {
    // La sesión no tiene tienda y aun así se acepta. Lo único que se exige es
    // que la tienda exista y esté activa.
    const { status } = await put({ tiendaId: "t9" });
    expect(status).toBe(200);
    const [args] = prismaMock.tienda.findFirst.mock.calls[0] as unknown as [
      { where: { id: string; activa: boolean } },
    ];
    expect(args.where).toMatchObject({ id: "t9", activa: true });
  });

  it("dice que la caja no lleva importes cuando la sede no maneja efectivo", async () => {
    prismaMock.tienda.findFirst.mockResolvedValue({
      id: "t_eci",
      nombre: "NEKSUS ECI POZUELO",
      sinEfectivo: true,
    });
    const { data } = await put({ tiendaId: "t_eci" });
    expect((data.sede as { sinEfectivo: boolean }).sinEfectivo).toBe(true);
  });

  it("una sede cerrada o inventada no cuela", async () => {
    prismaMock.tienda.findFirst.mockResolvedValue(null);
    const { status } = await put({ tiendaId: "t_fantasma" });
    expect(status).toBe(404);
    expect(prismaMock.cierreTurno.upsert).not.toHaveBeenCalled();
  });

  it("sin tienda se pide elegirla, en vez de dejar el cierre sin sede", async () => {
    const { status } = await put({});
    expect(status).toBe(400);
    expect(prismaMock.cierreTurno.upsert).not.toHaveBeenCalled();
  });
});
