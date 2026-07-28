/**
 * Aviso por email cuando un empleado ficha fuera del radio de su sede.
 *
 * Ticket ea004e48: el OWNER quiere que le llegue un correo cuando alguien
 * ficha a más distancia de la sede que el radio configurado (200 m por
 * defecto). El fichaje NUNCA se rechaza — RD 8/2019.
 *
 * Verifica que:
 *  1. Fuera del radio → email a OWNER + managers de la sede (no al empleado).
 *  2. Dentro del radio → ningún email.
 *  3. `notifFueraSede = false` → ningún email.
 *  4. El fichaje se guarda con 201 en todos los casos.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const cfg = {
  notifFueraSede: true,
  nombre: "Acme",
  appNombre: "Acme",
  colorPrimario: "#6366f1",
  colorSidebar: "#1e1b4b",
  logo: null,
  geoObligatoria: false,
  faceIdObligatorio: false,
  faceIdGuardarFoto: false,
  fichajeMovilActivo: true,
  fichajeTabletActivo: true,
};

// Sede en Madrid centro, radio 200 m.
const SEDE = {
  id: "tienda_1",
  nombre: "Sede Centro",
  radio: 200,
  latitud: 40.4168,
  longitud: -3.7038,
};

vi.mock("@/lib/prisma", () => ({
  prismaApp: {
    fichaje: {
      findFirst: vi.fn().mockResolvedValue(null), // sin fichajes previos
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "fic_1",
        ...data,
        timestamp: new Date("2026-07-27T08:03:00Z"),
        user: { id: data.userId, nombre: "Ana", apellidos: "García", email: "ana@acme.es" },
        tienda: { id: SEDE.id, nombre: SEDE.nombre },
      })),
    },
    configuracionEmpresa: { findUnique: vi.fn().mockResolvedValue(cfg) },
    faceTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
    tienda: { findUnique: vi.fn().mockResolvedValue(SEDE) },
    user: {
      findMany: vi.fn().mockResolvedValue([
        { id: "owner_1", email: "owner@acme.es", nombre: "Owner" },
        { id: "mgr_1", email: "mgr@acme.es", nombre: "Manager" },
      ]),
    },
  },
  prismaMaster: {},
  prismaRuntime: {},
  prismaQuotaWriter: {},
}));

vi.mock("@/lib/email", () => ({
  sendSystemEmail: vi.fn().mockResolvedValue(undefined),
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "user_1", rol: "EMPLEADO", tiendaId: "tienda_1", name: "Ana" },
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

/** POST /api/fichajes con geofencing activo desde las coordenadas dadas. */
async function fichar(latitud: number, longitud: number) {
  const { POST } = await import("./route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://acme.localhost:3000/api/fichajes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tipo: "ENTRADA", latitud, longitud }),
  });
  return POST(req);
}

beforeEach(async () => {
  vi.clearAllMocks();
  cfg.notifFueraSede = true;
  ctx.features.clear();
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest([
    "geofencing",
    "historial_meses",
    "fichaje_movil",
    "fichaje_tablet",
    "face_id",
  ]);
  ctx.features.set("geofencing", {
    key: "geofencing",
    value: true,
    source: "plan",
    expiresAt: null,
  });
});

describe("POST /api/fichajes — aviso de fichaje fuera de la sede", () => {
  it("avisa a OWNER y managers cuando la distancia supera el radio", async () => {
    const { sendSystemEmail } = await import("@/lib/email");

    // ~356 m al norte de la sede (radio 200 m).
    const res = await fichar(40.42, -3.7038);
    expect(res.status).toBe(201);

    const send = vi.mocked(sendSystemEmail);
    expect(send).toHaveBeenCalledTimes(2);
    const destinatarios = send.mock.calls.map((c) => c[0]).sort();
    expect(destinatarios).toEqual(["mgr@acme.es", "owner@acme.es"]);

    const [, subject, html] = send.mock.calls[0]!;
    expect(subject).toContain("Ana García");
    expect(subject).toContain("356 m");
    expect(html).toContain("Sede Centro");
    expect(html).toContain("356 m");
  });

  it("no avisa cuando el fichaje está dentro del radio", async () => {
    const { sendSystemEmail } = await import("@/lib/email");

    // ~11 m de la sede.
    const res = await fichar(40.4169, -3.7038);
    expect(res.status).toBe(201);
    expect(vi.mocked(sendSystemEmail)).not.toHaveBeenCalled();
  });

  it("no avisa si el OWNER desactivó notifFueraSede", async () => {
    cfg.notifFueraSede = false;
    const { sendSystemEmail } = await import("@/lib/email");

    const res = await fichar(40.42, -3.7038);
    expect(res.status).toBe(201);
    expect(vi.mocked(sendSystemEmail)).not.toHaveBeenCalled();
  });

  it("nunca rechaza el fichaje aunque falle el envío del aviso (RD 8/2019)", async () => {
    const { sendSystemEmail } = await import("@/lib/email");
    vi.mocked(sendSystemEmail).mockRejectedValue(new Error("Resend caído"));

    const res = await fichar(40.42, -3.7038);
    expect(res.status).toBe(201);
  });
});
