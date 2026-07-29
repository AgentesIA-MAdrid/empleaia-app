/**
 * Checklist de fichaje en POST /api/fichajes — ticket c4bc33d6.
 *
 * Verifica que:
 *  1. Con el checklist activo, fichar sin confirmar los puntos → 400
 *     `checklist_requerido` y NO se crea el fichaje.
 *  2. Con todos los puntos marcados → 201 y se guardan las confirmaciones
 *     con el enunciado en snapshot.
 *  3. Con el checklist desactivado no se pide nada (ni se consulta la
 *     tabla de items).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const cfg = { checklistFichajeActivo: true };

const ITEMS = [
  { id: "chk_1", tipo: "ENTRADA", texto: "He revisado el stock", orden: 0, activo: true },
  { id: "chk_2", tipo: "ENTRADA", texto: "El fondo de caja es correcto", orden: 1, activo: true },
];

vi.mock("@/lib/prisma", () => ({
  prismaApp: {
    fichaje: {
      findFirst: vi.fn().mockResolvedValue(null), // sin fichajes previos
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "fic_1",
        ...data,
        timestamp: new Date("2026-07-29T08:00:00Z"),
        user: { id: data.userId, nombre: "Ana", apellidos: "García", email: "ana@acme.es" },
        tienda: null,
      })),
    },
    configuracionEmpresa: { findUnique: vi.fn().mockResolvedValue(cfg) },
    faceTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
    tienda: { findUnique: vi.fn().mockResolvedValue(null) },
    checklistFichajeItem: { findMany: vi.fn().mockResolvedValue(ITEMS) },
    fichajeChecklist: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
  },
  prismaMaster: {},
  prismaRuntime: {},
  prismaQuotaWriter: {},
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "user_1", rol: "EMPLEADO", tiendaId: null, name: "Ana" },
  }),
}));

const ctx = {
  tenantId: "tnt_1",
  slug: "acme",
  status: "active" as const,
  features: new Map(),
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

async function postFichaje(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://acme.localhost:3000/api/fichajes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

beforeEach(async () => {
  vi.clearAllMocks();
  cfg.checklistFichajeActivo = true;
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest([
    "geofencing",
    "historial_meses",
    "fichaje_movil",
    "fichaje_tablet",
    "face_id",
  ]);
});

describe("POST /api/fichajes — checklist", () => {
  it("sin confirmar los puntos → 400 checklist_requerido y sin fichaje", async () => {
    const { prismaApp } = await import("@/lib/prisma");
    const res = await postFichaje({ tipo: "ENTRADA" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("checklist_requerido");
    expect(body.items).toHaveLength(2);
    expect(vi.mocked(prismaApp.fichaje.create)).not.toHaveBeenCalled();
  });

  it("con un punto sin marcar → 400", async () => {
    const res = await postFichaje({
      tipo: "ENTRADA",
      checklist: [{ itemId: "chk_1", marcado: true }],
    });
    expect(res.status).toBe(400);
  });

  it("con todos los puntos marcados → 201 y guarda las confirmaciones", async () => {
    const { prismaApp } = await import("@/lib/prisma");
    const res = await postFichaje({
      tipo: "ENTRADA",
      checklist: [
        { itemId: "chk_1", marcado: true },
        { itemId: "chk_2", marcado: true },
      ],
    });
    expect(res.status).toBe(201);
    const createMany = vi.mocked(prismaApp.fichajeChecklist.createMany);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]![0]).toEqual({
      data: [
        { fichajeId: "fic_1", itemId: "chk_1", texto: "He revisado el stock", orden: 0, marcado: true },
        { fichajeId: "fic_1", itemId: "chk_2", texto: "El fondo de caja es correcto", orden: 1, marcado: true },
      ],
    });
  });

  it("checklist desactivado → no se pide nada (RD 8/2019: fichar nunca se bloquea de más)", async () => {
    cfg.checklistFichajeActivo = false;
    const { prismaApp } = await import("@/lib/prisma");
    const res = await postFichaje({ tipo: "ENTRADA" });
    expect(res.status).toBe(201);
    expect(vi.mocked(prismaApp.checklistFichajeItem.findMany)).not.toHaveBeenCalled();
    expect(vi.mocked(prismaApp.fichajeChecklist.createMany)).not.toHaveBeenCalled();
  });

  it("PAUSA no pide checklist aunque esté activo", async () => {
    const { prismaApp } = await import("@/lib/prisma");
    const previo = { tipo: "ENTRADA" } as unknown as Awaited<
      ReturnType<typeof prismaApp.fichaje.findFirst>
    >;
    vi.mocked(prismaApp.fichaje.findFirst).mockResolvedValueOnce(previo);
    const res = await postFichaje({ tipo: "PAUSA" });
    expect(res.status).toBe(201);
    expect(vi.mocked(prismaApp.checklistFichajeItem.findMany)).not.toHaveBeenCalled();
  });
});
