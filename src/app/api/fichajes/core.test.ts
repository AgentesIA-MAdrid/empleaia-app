/**
 * Test CORE — Plan Fase 5 §7.4.
 *
 * RD 8/2019: el registro de jornada debe ser SIEMPRE accesible. Un
 * tenant en plan Starter (o cualquier plan sin features de export,
 * geofencing, etc.) debe poder fichar igual que uno enterprise.
 *
 * Verifica que:
 *  1. El handler de POST /api/fichajes NO lanza por features ausentes.
 *  2. Una transición ENTRADA válida con ctx.features VACÍO devuelve 201.
 *  3. La regla ESLint no-feature-gate-on-core complementa esto en
 *     compile-time. Este test cubre runtime.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prismaApp con tablas mínimas.
vi.mock("@/lib/prisma", () => {
  const created: Record<string, unknown>[] = [];
  return {
    prismaApp: {
      fichaje: {
        findFirst: vi.fn().mockResolvedValue(null), // sin fichajes previos
        create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return {
            id: `fic_${created.length}`,
            ...data,
            user: { id: data.userId, nombre: "X", apellidos: "Y", email: "x@y" },
            tienda: null,
          };
        }),
      },
      // Tenant Starter sin configuración de empresa (singleton ausente):
      // el handler lee políticas con cfg?. → todos los toggles falsy.
      configuracionEmpresa: { findUnique: vi.fn().mockResolvedValue(null) },
      // Solo se consulta si el plan tiene face_id; en estos tests no.
      faceTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
    },
    prismaMaster: {},
    prismaRuntime: {},
    prismaQuotaWriter: {},
  };
});

// Mock auth: sesión válida.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "user_1", rol: "EMPLEADO", tiendaId: null, name: "X" },
  }),
}));

// Mock withTenant: identity con runWithTenant + ctx vacío (Starter "lite").
const ctxStarter = {
  tenantId: "tnt_starter",
  slug: "starter1",
  status: "active" as const,
  features: new Map(), // SIN features — peor caso.
};

vi.mock("@/lib/tenant/with-tenant", async () => {
  const { runWithTenant } = await import("@/lib/tenant/context");
  return {
    withTenant: <Args extends unknown[]>(
      h: (req: import("next/server").NextRequest, ...rest: Args) => Promise<Response> | Response,
    ) => async (req: import("next/server").NextRequest, ...rest: Args) =>
      runWithTenant(ctxStarter, () => h(req, ...rest)),
  };
});

beforeEach(async () => {
  vi.clearAllMocks();
  ctxStarter.features.clear();
  // Catálogo de features conocidas — assertKnownFeature lo requiere.
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest([
    "geofencing",
    "historial_meses",
    "fichaje_movil",
    "fichaje_tablet",
    "face_id",
  ]);
});

describe("CORE — POST /api/fichajes con tenant sin features", () => {
  it("permite ENTRADA aunque ctx.features esté vacío (RD 8/2019)", async () => {
    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://starter1.localhost:3000/api/fichajes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tipo: "ENTRADA" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("descarta lat/lon cuando geofencing está OFF", async () => {
    const { POST } = await import("./route");
    const { prismaApp } = await import("@/lib/prisma");
    const { NextRequest } = await import("next/server");

    const createSpy = vi.mocked(prismaApp.fichaje.create);
    createSpy.mockClear();

    const req = new NextRequest("http://starter1.localhost:3000/api/fichajes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tipo: "ENTRADA",
        latitud: 40.4,
        longitud: -3.7,
        distancia: 50,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const lastCall = createSpy.mock.calls[createSpy.mock.calls.length - 1]![0];
    expect(lastCall.data.latitud).toBeNull();
    expect(lastCall.data.longitud).toBeNull();
    expect(lastCall.data.distancia).toBeNull();
  });

  it("registra lat/lon cuando geofencing está ON", async () => {
    ctxStarter.features.set("geofencing", {
      key: "geofencing",
      value: true,
      source: "plan",
      expiresAt: null,
    });
    const { POST } = await import("./route");
    const { prismaApp } = await import("@/lib/prisma");
    const { NextRequest } = await import("next/server");

    const createSpy = vi.mocked(prismaApp.fichaje.create);
    createSpy.mockClear();

    const req = new NextRequest("http://starter1.localhost:3000/api/fichajes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tipo: "ENTRADA",
        latitud: 40.4,
        longitud: -3.7,
        distancia: 50,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const lastCall = createSpy.mock.calls[createSpy.mock.calls.length - 1]![0];
    expect(lastCall.data.latitud).toBe(40.4);
    expect(lastCall.data.longitud).toBe(-3.7);
    expect(lastCall.data.distancia).toBe(50);
  });
});
