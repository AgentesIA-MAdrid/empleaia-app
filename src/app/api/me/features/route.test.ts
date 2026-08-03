/**
 * Tests del endpoint /api/me/features con clasificación ternaria.
 *
 * Cubre el bug detectado en parada obligatoria post-commit 8: las
 * features tipo `quota` caían en `limits` porque classifyFeature
 * solo distinguía boolean vs number. Ahora el catálogo
 * `master.features.type` es la fuente de verdad ternaria.
 *
 * Mocks:
 *  - `prismaMaster.feature.findMany`: catálogo tipado.
 *  - `prismaRuntime.tenantQuotaUsage.findMany`: filas existentes (o no).
 *  - `prismaApp.user.count` / `tienda.count`: loaders del current opt-in.
 *  - `withTenant`: identidad envuelta en runWithTenant con un ctx fijo,
 *    para no resolver host ni tocar JWT.
 *  - `auth`: sesión válida por defecto. El endpoint exige sesión desde la
 *    auditoría del 2026-08-04 (expone plantilla y consumo del cliente).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prismaMaster: {
    feature: { findMany: vi.fn() },
  },
  prismaRuntime: {
    tenantQuotaUsage: { findMany: vi.fn() },
  },
  prismaApp: {
    user: { count: vi.fn() },
    tienda: { count: vi.fn() },
  },
  prismaQuotaWriter: {},
}));

const mockCtx = {
  tenantId: "tnt_test1",
  slug: "test1",
  status: "active" as const,
  features: new Map(),
};

vi.mock("@/lib/tenant/with-tenant", async () => {
  const { runWithTenant } = await import("@/lib/tenant/context");
  return {
    withTenant: <Args extends unknown[]>(
      h: (req: NextRequest, ...rest: Args) => Promise<Response> | Response,
    ) => {
      return async (req: NextRequest, ...rest: Args) =>
        runWithTenant(mockCtx, () => h(req, ...rest));
    },
  };
});

let sesion: { user: { id: string; rol: string } } | null = {
  user: { id: "u_1", rol: "EMPLEADO" },
};
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sesion) }));

import { prismaMaster, prismaRuntime, prismaApp } from "@/lib/prisma";
import { _resetTypedCatalogForTest } from "@/lib/feature-guard/catalog";

const featureFindMany = vi.mocked(prismaMaster.feature.findMany);
const usageFindMany = vi.mocked(prismaRuntime.tenantQuotaUsage.findMany);
const userCount = vi.mocked(prismaApp.user.count);
const tiendaCount = vi.mocked(prismaApp.tienda.count);

beforeEach(() => {
  _resetTypedCatalogForTest();
  vi.clearAllMocks();
  mockCtx.features.clear();
  sesion = { user: { id: "u_1", rol: "EMPLEADO" } };
});

async function callGET(): Promise<Response> {
  const { GET } = await import("./route");
  const req = new NextRequest("http://test1.localhost:3000/api/me/features");
  return GET(req);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/me/features — clasificación ternaria", () => {
  it("clasifica boolean / limit / quota según master.features.type", async () => {
    featureFindMany.mockResolvedValue([
      { key: "geofencing", type: "boolean", quotaPeriod: null },
      { key: "export_csv", type: "boolean", quotaPeriod: null },
      { key: "max_employees", type: "limit", quotaPeriod: null },
      { key: "max_storage_mb", type: "limit", quotaPeriod: null },
      { key: "emails_mes", type: "quota", quotaPeriod: "mes" },
      { key: "api_calls_dia", type: "quota", quotaPeriod: "dia" },
    ] as never);

    mockCtx.features.set("geofencing", {
      key: "geofencing",
      value: true,
      source: "plan",
      expiresAt: null,
    });
    mockCtx.features.set("export_csv", {
      key: "export_csv",
      value: false,
      source: "plan",
      expiresAt: null,
    });
    mockCtx.features.set("max_employees", {
      key: "max_employees",
      value: 50,
      source: "plan",
      expiresAt: null,
    });
    mockCtx.features.set("max_storage_mb", {
      key: "max_storage_mb",
      value: 5000,
      source: "plan",
      expiresAt: null,
    });
    mockCtx.features.set("emails_mes", {
      key: "emails_mes",
      value: 200,
      source: "plan",
      expiresAt: null,
    });
    mockCtx.features.set("api_calls_dia", {
      key: "api_calls_dia",
      value: 1000,
      source: "plan",
      expiresAt: null,
    });

    userCount.mockResolvedValue(7);
    tiendaCount.mockResolvedValue(3);
    usageFindMany.mockResolvedValue([] as never);

    const res = await callGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      booleans: Record<string, boolean>;
      limits: Record<string, { current?: number; max: number | null }>;
      quotas: Record<string, { used: number; max: number | null; resetAt: string }>;
    };

    expect(body.booleans).toEqual({
      geofencing: true,
      export_csv: false,
    });

    expect(body.limits.max_employees).toEqual({ current: 7, max: 50 });
    expect(body.limits.max_storage_mb).toEqual({ max: 5000 });
    expect(body.limits).not.toHaveProperty("emails_mes");
    expect(body.limits).not.toHaveProperty("api_calls_dia");

    expect(Object.keys(body.quotas).sort()).toEqual([
      "api_calls_dia",
      "emails_mes",
    ]);
    expect(body.quotas.emails_mes).toMatchObject({ used: 0, max: 200 });
    expect(typeof body.quotas.emails_mes.resetAt).toBe("string");
    expect(body.quotas.api_calls_dia).toMatchObject({ used: 0, max: 1000 });
  });

  it("usa fila de tenant_quota_usage cuando existe (used > 0)", async () => {
    featureFindMany.mockResolvedValue([
      { key: "emails_mes", type: "quota", quotaPeriod: "mes" },
    ] as never);
    mockCtx.features.set("emails_mes", {
      key: "emails_mes",
      value: 200,
      source: "plan",
      expiresAt: null,
    });
    userCount.mockResolvedValue(0);
    tiendaCount.mockResolvedValue(0);

    const periodEnd = new Date("2026-05-01T00:00:00.000Z");
    usageFindMany.mockResolvedValue([
      {
        featureKey: "emails_mes",
        consumed: BigInt(42),
        max: BigInt(200),
        periodEnd,
      },
    ] as never);

    const res = await callGET();
    const body = await res.json();
    expect(body.quotas.emails_mes).toEqual({
      used: 42,
      max: 200,
      resetAt: periodEnd.toISOString(),
    });
  });

  it("sintetiza quota sin fila con resetAt en futuro", async () => {
    featureFindMany.mockResolvedValue([
      { key: "emails_mes", type: "quota", quotaPeriod: "mes" },
    ] as never);
    mockCtx.features.set("emails_mes", {
      key: "emails_mes",
      value: 200,
      source: "plan",
      expiresAt: null,
    });
    userCount.mockResolvedValue(0);
    tiendaCount.mockResolvedValue(0);
    usageFindMany.mockResolvedValue([] as never);

    const res = await callGET();
    const body = await res.json();
    const resetAt = new Date(body.quotas.emails_mes.resetAt);
    expect(resetAt.getTime()).toBeGreaterThan(Date.now());
    expect(body.quotas.emails_mes.used).toBe(0);
  });

  it("limit con valor null se expone con max:null (unlimited)", async () => {
    featureFindMany.mockResolvedValue([
      { key: "max_employees", type: "limit", quotaPeriod: null },
    ] as never);
    mockCtx.features.set("max_employees", {
      key: "max_employees",
      value: null,
      source: "plan",
      expiresAt: null,
    });
    userCount.mockResolvedValue(99);
    tiendaCount.mockResolvedValue(0);
    usageFindMany.mockResolvedValue([] as never);

    const res = await callGET();
    const body = await res.json();
    expect(body.limits.max_employees).toEqual({ current: 99, max: null });
  });

  it("loader del current que falla deja max sin current", async () => {
    featureFindMany.mockResolvedValue([
      { key: "max_employees", type: "limit", quotaPeriod: null },
    ] as never);
    mockCtx.features.set("max_employees", {
      key: "max_employees",
      value: 10,
      source: "plan",
      expiresAt: null,
    });
    userCount.mockRejectedValue(new Error("table missing"));
    tiendaCount.mockResolvedValue(0);
    usageFindMany.mockResolvedValue([] as never);

    const res = await callGET();
    const body = await res.json();
    expect(body.limits.max_employees).toEqual({ max: 10 });
    expect(body.limits.max_employees).not.toHaveProperty("current");
  });

  it("feature en tenant_features pero no en catálogo activo: omitida", async () => {
    featureFindMany.mockResolvedValue([
      { key: "geofencing", type: "boolean", quotaPeriod: null },
    ] as never);
    mockCtx.features.set("geofencing", {
      key: "geofencing",
      value: true,
      source: "plan",
      expiresAt: null,
    });
    mockCtx.features.set("zombie_feature", {
      key: "zombie_feature",
      value: 1,
      source: "plan",
      expiresAt: null,
    });
    userCount.mockResolvedValue(0);
    tiendaCount.mockResolvedValue(0);
    usageFindMany.mockResolvedValue([] as never);

    const res = await callGET();
    const body = await res.json();
    expect(body.booleans).toEqual({ geofencing: true });
    expect(body.limits).not.toHaveProperty("zombie_feature");
    expect(body.quotas).not.toHaveProperty("zombie_feature");
  });
});

describe("GET /api/me/features — exige sesión", () => {
  it("sin sesión responde 401 y no cuenta empleados ni tiendas", async () => {
    // `withTenant` resuelve el tenant por el Host, no autentica: sin este
    // guard un anónimo leía plantilla activa, nº de tiendas y consumo de
    // cuota de cualquier cliente sabiendo solo su subdominio.
    sesion = null;
    featureFindMany.mockResolvedValue([] as never);

    const res = await callGET();

    expect(res.status).toBe(401);
    expect(userCount).not.toHaveBeenCalled();
    expect(tiendaCount).not.toHaveBeenCalled();
  });
});
