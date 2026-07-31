/**
 * GET /api/documentos — qué documentos marca como "ya firmados por mí".
 *
 * Lo que protege (ticket 6b0f74d2): el empleado que ha firmado un documento
 * descarga su copia sellada y deja de ver la preliminar. La marca la pone el
 * servidor, y tiene que cumplir tres cosas:
 *
 *  1. Solo cuenta la firma DE ESE empleado (no la de un compañero).
 *  2. Solo cuenta si hay copia sellada: una firma sobre un documento que no se
 *     pudo estampar no deja nada que descargar, y ahí la preliminar es lo único
 *     que tiene.
 *  3. La consulta NO trae el PDF sellado, que son cientos de KB por documento.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" },
};

const DOCUMENTOS = [
  { id: "doc_contrato", nombre: "Contrato.pdf", userId: "u_ana", firmas: [] },
  { id: "doc_anexo", nombre: "Anexo.pdf", userId: "u_ana", firmas: [] },
  { id: "doc_codigo", nombre: "Codigo etico.pdf", userId: "u_ana", firmas: [] },
];

/** Firmas con copia sellada. Las devuelve el `findMany` de Firma. */
let firmasConSello: { documentoId: string }[] = [];

const prismaMock = {
  documento: { findMany: vi.fn(async () => DOCUMENTOS) },
  firma: { findMany: vi.fn(async () => firmasConSello) },
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
    ["documentos", { key: "documentos", value: true, source: "plan" as const, expiresAt: null }],
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
  const res = await GET(new NextRequest("http://acme.localhost:3000/api/documentos"));
  return {
    status: res.status,
    documentos: ((await res.json()) as {
      documentos: { id: string; firmadoPorMi: boolean }[];
    }).documentos,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  firmasConSello = [];
  sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["documentos"]);
});

describe("GET /api/documentos — marca de copia firmada propia", () => {
  it("sin firmas, ninguno está marcado: se sigue viendo la preliminar", async () => {
    const { documentos } = await get();
    expect(documentos.map((d) => d.firmadoPorMi)).toEqual([false, false, false]);
  });

  it("marca solo el documento que tiene copia sellada", async () => {
    firmasConSello = [{ documentoId: "doc_contrato" }];
    const { documentos } = await get();
    expect(documentos.find((d) => d.id === "doc_contrato")?.firmadoPorMi).toBe(true);
    expect(documentos.find((d) => d.id === "doc_anexo")?.firmadoPorMi).toBe(false);
  });

  it("pregunta por SUS firmas y solo por las que tienen copia sellada", async () => {
    await get();
    expect(prismaMock.firma.findMany).toHaveBeenCalledWith({
      where: {
        userId: "u_ana",
        documentoFirmadoUrl: { not: null },
        documentoId: { in: ["doc_contrato", "doc_anexo", "doc_codigo"] },
      },
      // Sin el PDF: son cientos de KB por documento y aquí solo hace falta
      // saber si existe.
      select: { documentoId: true },
    });
  });
});
