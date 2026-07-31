/**
 * GET /api/cierre-turno/detalle — alcance por rol.
 *
 * Lo que protege: que el filtro va en la consulta y no después. Un comercial
 * con el id del cierre de un compañero no debe ver nada, y un coordinador solo
 * los de su sede. Si esto se rompe, el módulo filtra datos de caja de otras
 * tiendas y no se nota en pantalla.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1" as string | null, name: "Ana" },
};

const CIERRE = {
  id: "c1",
  fecha: new Date("2026-07-30T00:00:00Z"),
  estado: "completado",
  detalleJornada: "Dos altas de fibra",
  incidencia: null,
  completadoEn: new Date("2026-07-30T21:00:00Z"),
  user: { id: "u_ana", nombre: "Ana", apellidos: "García", email: "ana@acme.es" },
  tienda: { id: "t1", nombre: "Centro" },
  ventas: [{ id: "v1", nombreArticulo: "Alta de fibra", cantidad: 2, articuloId: "art_fibra" }],
  caja: {
    id: "caja1",
    efectivo: 100,
    tarjeta: 50,
    confirmadoEn: new Date("2026-07-30T20:55:00Z"),
    adjuntos: [],
    ediciones: [],
  },
};

const prismaMock = {
  cierreTurno: { findFirst: vi.fn(async () => CIERRE as unknown) },
  configuracionEmpresa: { findUnique: vi.fn(async () => ({ ventasPreciosActivos: true })) },
  articuloVenta: { findMany: vi.fn(async () => [{ id: "art_fibra", precio: 30 }]) },
  // Sedes que coordina quien mira (ticket 73): el alcance de sede es en plural.
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

async function get(query: string) {
  const { GET } = await import("./route");
  const { NextRequest } = await import("next/server");
  return GET(new NextRequest(`http://acme.localhost:3000/api/cierre-turno/detalle${query}`));
}

beforeEach(async () => {
  vi.clearAllMocks();
  prismaMock.cierreTurno.findFirst.mockResolvedValue(CIERRE);
  sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("GET /api/cierre-turno/detalle", () => {
  it("sin id no hay nada que mirar", async () => {
    expect((await get("")).status).toBe(400);
  });

  it("un comercial solo consulta los suyos: el filtro va en la consulta", async () => {
    await get("?id=c1");
    expect(prismaMock.cierreTurno.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "c1", userId: "u_ana" }) }),
    );
  });

  it("un coordinador queda limitado a las sedes que lleva", async () => {
    sesion.user = { id: "u_jefe", rol: "MANAGER", tiendaId: "t1", name: "Jefe" };
    await get("?id=c1");
    expect(prismaMock.cierreTurno.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "c1", tiendaId: { in: ["t1", "t2"] } }),
      }),
    );
  });

  it("un coordinador SIN sedes asignadas no ve ninguna, no todas", async () => {
    // El bug que esto cierra: con la lista vacía, un filtro construido con
    // `...(x ? {} : {})` desaparece y deja ver la caja de toda la cadena.
    sesion.user = { id: "u_jefe", rol: "MANAGER", tiendaId: null, name: "Jefe" };
    prismaMock.usuarioSede.findMany.mockResolvedValueOnce([]);
    await get("?id=c1");
    expect(prismaMock.cierreTurno.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tiendaId: { in: [] } }) }),
    );
  });

  it("un administrador no lleva filtro de alcance", async () => {
    sesion.user = { id: "u_owner", rol: "OWNER", tiendaId: null, name: "Owner" };
    await get("?id=c1");
    const [args] = prismaMock.cierreTurno.findFirst.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).toEqual({ id: "c1" });
  });

  it("un id que no pasa el alcance devuelve 404, no un 403 que confirmaría que existe", async () => {
    prismaMock.cierreTurno.findFirst.mockResolvedValue(null);
    expect((await get("?id=ajeno")).status).toBe(404);
  });

  it("el autor no puede corregir su propia caja ya confirmada", async () => {
    const res = await get("?id=c1");
    const data = (await res.json()) as { puedeCorregir: boolean; importeVendido: number };
    expect(data.puedeCorregir).toBe(false);
    // 2 unidades × 30 € del catálogo.
    expect(data.importeVendido).toBe(60);
  });

  it("un administrador sí puede corregirla", async () => {
    sesion.user = { id: "u_owner", rol: "OWNER", tiendaId: null, name: "Owner" };
    const res = await get("?id=c1");
    const data = (await res.json()) as { puedeCorregir: boolean };
    expect(data.puedeCorregir).toBe(true);
  });
});
