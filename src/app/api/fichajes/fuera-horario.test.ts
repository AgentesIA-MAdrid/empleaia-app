/**
 * Ticket 25c81b6b: no se ficha antes ni después del horario del cuadrante.
 *
 * Verifica que:
 *  1. Con el interruptor apagado, fichar fuera de horario sigue funcionando.
 *  2. Encendido y fuera del turno → 409 `fuera_de_horario` con el horario del
 *     turno y la hora a la que se ajustaría el fichaje.
 *  3. Dentro del turno (o del margen de cortesía) → 201.
 *  4. Sin turno publicado no se comprueba nada: el fichaje entra.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const cfg = {
  notifFueraSede: false,
  nombre: "Acme",
  geoObligatoria: false,
  faceIdObligatorio: false,
  faceIdGuardarFoto: false,
  fichajeMovilActivo: true,
  fichajeTabletActivo: true,
  checklistFichajeActivo: false,
  exigirFichajeEnHorario: true,
  margenFichajeMinutos: 15,
  zonaHoraria: "Europe/Madrid",
};

/** Turno de hoy 09:00–17:00 (o vacío según el test). */
let turnos: { horaInicio: string; horaFin: string; fecha: Date }[] = [];

vi.mock("@/lib/prisma", () => ({
  prismaApp: {
    fichaje: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "fic_1",
        ...data,
        timestamp: new Date(),
        user: { id: data.userId, nombre: "Ana", apellidos: "García", email: "ana@acme.es" },
        tienda: null,
      })),
    },
    configuracionEmpresa: { findUnique: vi.fn().mockImplementation(async () => cfg) },
    faceTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
    tienda: { findUnique: vi.fn().mockResolvedValue(null) },
    turno: { findMany: vi.fn().mockImplementation(async () => turnos) },
    checklistFichajeItem: { findMany: vi.fn().mockResolvedValue([]) },
    fichajeChecklist: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
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

/** POST /api/fichajes de ENTRADA con el reloj congelado en `horaMadrid`. */
async function ficharA(horaMadrid: string) {
  // Verano en Madrid: UTC+2. "07:40" locales = 05:40Z.
  vi.setSystemTime(new Date(`2026-07-31T${horaMadrid}:00.000Z`));
  const { POST } = await import("./route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://acme.localhost:3000/api/fichajes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tipo: "ENTRADA" }),
  });
  return POST(req);
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  cfg.exigirFichajeEnHorario = true;
  cfg.margenFichajeMinutos = 15;
  turnos = [{ horaInicio: "09:00", horaFin: "17:00", fecha: new Date("2026-07-31T00:00:00Z") }];
  ctx.features.clear();
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["geofencing", "historial_meses", "fichaje_movil", "fichaje_tablet", "face_id"]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/fichajes — fichaje fuera del horario del cuadrante", () => {
  it("con el interruptor apagado no comprueba el horario", async () => {
    cfg.exigirFichajeEnHorario = false;
    const res = await ficharA("05:40"); // 07:40 en Madrid
    expect(res.status).toBe(201);
  });

  it("antes del turno responde 409 con el ajuste al inicio", async () => {
    const res = await ficharA("05:40"); // 07:40 en Madrid
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("fuera_de_horario");
    expect(body.motivo).toBe("antes");
    expect(body.turno).toEqual({ horaInicio: "09:00", horaFin: "17:00" });
    expect(body.ajusteHora).toBe("09:00");
    expect(body.ajuste).toBe("2026-07-31T07:00:00.000Z");
  });

  it("después del turno responde 409 con el ajuste al fin", async () => {
    const res = await ficharA("16:30"); // 18:30 en Madrid
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("fuera_de_horario");
    expect(body.motivo).toBe("despues");
    expect(body.ajusteHora).toBe("17:00");
  });

  it("dentro del margen de cortesía deja fichar", async () => {
    const res = await ficharA("06:50"); // 08:50 en Madrid, turno a las 09:00
    expect(res.status).toBe(201);
  });

  it("dentro del turno deja fichar", async () => {
    const res = await ficharA("08:00"); // 10:00 en Madrid
    expect(res.status).toBe(201);
  });

  it("sin turno publicado no bloquea el fichaje (RD 8/2019)", async () => {
    turnos = [];
    const res = await ficharA("05:40");
    expect(res.status).toBe(201);
  });
});
