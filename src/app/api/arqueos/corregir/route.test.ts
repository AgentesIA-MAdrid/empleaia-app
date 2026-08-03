/**
 * PUT /api/arqueos/corregir — administración corrige un arqueo (ticket 5a71fe28).
 *
 * Se toca dinero ya firmado, así que lo que hay que proteger es:
 *  1. Que solo pueda administración.
 *  2. Que siempre quede el rastro (quién, cuándo, importes antes y después) y
 *     que sin motivo no se guarde nada — es lo que la app promete al empleado.
 *  3. Que no se pueda dejar el arqueo en un estado imposible (haberse llevado
 *     más de lo que había).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_own", rol: "OWNER", tiendaId: null as string | null, name: "Owner" },
};

const arqueo = {
  id: "arq1",
  semana: "2026-W31",
  estado: "recogido",
  efectivoDeclarado: 500,
  efectivoRecogido: 500 as number | null,
  saldoEsperado: 480 as number | null,
  tienda: { nombre: "NEKSUS CARTAGENA" },
};

const prismaMock = {
  arqueo: {
    findUnique: vi.fn(async () => arqueo as unknown),
    update: vi.fn(async () => ({}) as unknown),
  },
  arqueoCorreccion: { create: vi.fn(async () => ({ id: "cor1" })) },
  configuracionEmpresa: { findUnique: vi.fn(async () => ({ umbralDescuadreEur: 1 })) },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
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

const MOTIVO = "Se contó dos veces un billete de 50; recuento con la tienda.";

async function corregir(body: unknown) {
  const { PUT } = await import("./route");
  const { NextRequest } = await import("next/server");
  const res = await PUT(
    new NextRequest("http://acme.localhost:3000/api/arqueos/corregir", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  vi.clearAllMocks();
  sesion.user = { id: "u_own", rol: "OWNER", tiendaId: null, name: "Owner" };
  arqueo.estado = "recogido";
  arqueo.efectivoDeclarado = 500;
  arqueo.efectivoRecogido = 500;
  prismaMock.arqueo.findUnique.mockResolvedValue(arqueo);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
  );
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("PUT /api/arqueos/corregir", () => {
  it("corrige un arqueo YA FIRMADO, que antes no podía tocar nadie", async () => {
    const { status, data } = await corregir({
      arqueoId: "arq1",
      efectivoDeclarado: "450",
      efectivoRecogido: "450",
      motivo: MOTIVO,
    });
    expect(status).toBe(200);
    expect(data.declarado).toBe(450);
    // Y la diferencia se recalcula contra el acumulado con el que se declaró.
    expect(data.esperado).toBe(480);
    expect(data.diferencia).toBe(-30);
  });

  it("guarda el rastro: importes antes y después, motivo y quién", async () => {
    await corregir({
      arqueoId: "arq1",
      efectivoDeclarado: "450",
      efectivoRecogido: "450",
      motivo: MOTIVO,
    });
    const [args] = prismaMock.arqueoCorreccion.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(args.data).toMatchObject({
      arqueoId: "arq1",
      declaradoAntes: 500,
      declaradoDespues: 450,
      recogidoAntes: 500,
      recogidoDespues: 450,
      corregidoPorId: "u_own",
    });
    expect(String(args.data.motivo)).toContain("billete de 50");
  });

  it("el importe y el rastro se guardan juntos o no se guarda nada", async () => {
    // Corregir dinero sin dejar constancia es exactamente lo que no puede pasar.
    await corregir({ arqueoId: "arq1", efectivoDeclarado: "450", motivo: MOTIVO });
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it("sin motivo no se corrige nada", async () => {
    const { status } = await corregir({ arqueoId: "arq1", efectivoDeclarado: "450", motivo: "" });
    expect(status).toBe(400);
    expect(prismaMock.arqueo.update).not.toHaveBeenCalled();
  });

  it("un motivo de tres letras tampoco vale", async () => {
    const { status } = await corregir({ arqueoId: "arq1", efectivoDeclarado: "450", motivo: "ok" });
    expect(status).toBe(400);
  });

  it("no se puede haber recogido más de lo que había en el sobre", async () => {
    const { status, data } = await corregir({
      arqueoId: "arq1",
      efectivoDeclarado: "400",
      efectivoRecogido: "450",
      motivo: MOTIVO,
    });
    expect(status).toBe(400);
    expect(String(data.error)).toContain("más de lo que la tienda declaró");
    expect(prismaMock.arqueo.update).not.toHaveBeenCalled();
  });

  it("en un arqueo sin firmar no hay importe recogido que corregir", async () => {
    arqueo.estado = "pendiente";
    const { status } = await corregir({
      arqueoId: "arq1",
      efectivoDeclarado: "450",
      efectivoRecogido: "450",
      motivo: MOTIVO,
    });
    expect(status).toBe(400);
  });

  it("los mismos importes no son una corrección", async () => {
    // Si no, el historial se llenaría de entradas que no cambian nada.
    const { status } = await corregir({
      arqueoId: "arq1",
      efectivoDeclarado: "500",
      efectivoRecogido: "500",
      motivo: MOTIVO,
    });
    expect(status).toBe(400);
    expect(prismaMock.arqueoCorreccion.create).not.toHaveBeenCalled();
  });

  it("esto no lo hace un empleado ni un coordinador", async () => {
    for (const rol of ["EMPLEADO", "MANAGER"]) {
      sesion.user = { id: "u_ana", rol, tiendaId: "t1", name: "Ana" };
      const { status } = await corregir({
        arqueoId: "arq1",
        efectivoDeclarado: "450",
        motivo: MOTIVO,
      });
      expect(status).toBe(403);
    }
    expect(prismaMock.arqueo.update).not.toHaveBeenCalled();
  });

  it("un arqueo que ya no existe da 404", async () => {
    prismaMock.arqueo.findUnique.mockResolvedValue(null);
    const { status } = await corregir({
      arqueoId: "fantasma",
      efectivoDeclarado: "450",
      motivo: MOTIVO,
    });
    expect(status).toBe(404);
  });
});
