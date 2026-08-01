/**
 * POST /api/cierre-turno/adjuntos — el ticket del gasto (ticket 7f52ba3e).
 *
 * Cuando alguien paga algo de la tienda con el dinero de la caja —folios,
 * limpieza, una urgencia—, ese dinero sale del sobre. Sin el ticket, aparece
 * como un descuadre que nadie sabe explicar tres días después.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = { user: { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" } };

const cierre = {
  id: "c1",
  completadoEn: null as Date | null,
  caja: { id: "caja1" } as { id: string } | null,
};

const prismaMock = {
  cierreTurno: { findUnique: vi.fn(async () => cierre as unknown) },
  cierreCajaAdjunto: {
    create: vi.fn(async () => ({
      id: "adj1",
      tipo: "gasto",
      nombre: "ticket.jpg",
      mime: "image/jpeg",
      tamañoBytes: 12,
      createdAt: new Date("2026-08-01T18:00:00Z"),
    })),
  },
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

/** Un JPEG mínimo en base64, para no depender de ficheros de prueba. */
const FOTO = Buffer.from("ffd8ffe000104a46494600010100", "hex").toString("base64");

async function subir(body: unknown) {
  const { POST } = await import("./route");
  const { NextRequest } = await import("next/server");
  const res = await POST(
    new NextRequest("http://acme.localhost:3000/api/cierre-turno/adjuntos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  vi.clearAllMocks();
  cierre.completadoEn = null;
  cierre.caja = { id: "caja1" };
  prismaMock.cierreTurno.findUnique.mockResolvedValue(cierre);
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("adjuntar el ticket de un gasto pagado con la caja", () => {
  it("se guarda con tipo gasto, colgando de la caja del día", async () => {
    const { status } = await subir({
      tipo: "gasto",
      nombre: "ticket.jpg",
      mime: "image/jpeg",
      contenidoBase64: FOTO,
    });
    expect(status).toBe(201);
    const [args] = prismaMock.cierreCajaAdjunto.create.mock.calls[0] as unknown as [
      { data: { tipo: string; cajaId: string } },
    ];
    expect(args.data.tipo).toBe("gasto");
    expect(args.data.cajaId).toBe("caja1");
  });

  it("una foto del ticket vale: es lo que van a hacer", async () => {
    const { status } = await subir({
      tipo: "gasto",
      nombre: "IMG_2054.jpg",
      mime: "image/jpeg",
      contenidoBase64: FOTO,
    });
    expect(status).toBe(201);
  });

  it("un tipo inventado no cuela", async () => {
    const { status } = await subir({
      tipo: "loquesea",
      nombre: "x.jpg",
      mime: "image/jpeg",
      contenidoBase64: FOTO,
    });
    expect(status).toBe(400);
    expect(prismaMock.cierreCajaAdjunto.create).not.toHaveBeenCalled();
  });

  it("un ejecutable disfrazado tampoco", async () => {
    const { status, data } = await subir({
      tipo: "gasto",
      nombre: "virus.exe",
      mime: "application/x-msdownload",
      contenidoBase64: FOTO,
    });
    expect(status).toBe(400);
    expect(String(data.error)).toContain("Formato no admitido");
  });

  it("con el turno ya cerrado no se adjunta nada más", async () => {
    cierre.completadoEn = new Date();
    const { status } = await subir({
      tipo: "gasto",
      nombre: "ticket.jpg",
      mime: "image/jpeg",
      contenidoBase64: FOTO,
    });
    expect(status).toBe(409);
  });
});
