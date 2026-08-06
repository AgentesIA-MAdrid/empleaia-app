/**
 * Ticket 25c81b6b: no se ficha antes ni después del horario del cuadrante.
 *
 * Verifica que:
 *  1. Con el interruptor apagado, fichar fuera de horario sigue funcionando.
 *  2. Encendido y fuera del turno → 409 `fuera_de_horario` con el horario del
 *     turno. Ticket c726acd0: no hay atajo, ni ajuste al borde del turno ni
 *     nada que se pueda aceptar desde el propio fichaje.
 *  3. Dentro del turno (o del margen de cortesía) → 201.
 *  4. Sin turno publicado no se comprueba nada: el fichaje entra.
 *  5. Al cerrar el turno fuera de hora se le manda a la solicitud de fichaje,
 *     que es donde administración lo registra (RD 8/2019).
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
  margenFichajeMinutos: 10,
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
async function ficharA(
  horaMadrid: string,
  extra: { ajustarAlTurno?: boolean; nota?: string; tipo?: string } = {},
) {
  // `ajustarAlTurno` ya no lo lee el handler (ticket c726acd0). Se sigue
  // pudiendo mandar en el cuerpo para fijar que mandarlo no salta el bloqueo.
  // Verano en Madrid: UTC+2. "07:40" locales = 05:40Z.
  vi.setSystemTime(new Date(`2026-07-31T${horaMadrid}:00.000Z`));
  const { POST } = await import("./route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://acme.localhost:3000/api/fichajes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tipo: extra.tipo ?? "ENTRADA", ...extra }),
  });
  return POST(req);
}

/** Deja el estado como si ya hubiera fichado la ENTRADA (para probar SALIDA). */
async function conEntradaFichada() {
  const { prismaApp } = await import("@/lib/prisma");
  (prismaApp.fichaje.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
    .mockResolvedValue({ id: "fic_0", tipo: "ENTRADA" });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // `clearAllMocks` no deshace un `mockResolvedValue`: sin esto, el test que
  // simula "ya ha fichado la ENTRADA" contagiaría a los siguientes y sus
  // entradas se rechazarían por transición inválida.
  const { prismaApp } = await import("@/lib/prisma");
  (prismaApp.fichaje.findFirst as unknown as { mockResolvedValue: (v: unknown) => void })
    .mockResolvedValue(null);
  cfg.exigirFichajeEnHorario = true;
  cfg.margenFichajeMinutos = 10;
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

  it("antes del turno responde 409 y no ofrece ningún atajo", async () => {
    const res = await ficharA("05:40"); // 07:40 en Madrid
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("fuera_de_horario");
    expect(body.motivo).toBe("antes");
    expect(body.turno).toEqual({ horaInicio: "09:00", horaFin: "17:00" });
    expect(body.error).toContain("Fuera de turno");
    // Ticket c726acd0: se acabó el "registrar a las 09:00" con un clic.
    expect(body.ajustable).toBeUndefined();
    expect(body.ajusteHora).toBeUndefined();
    expect(body.ajuste).toBeUndefined();
  });

  it("la salida después del turno responde 409 y manda a solicitar el cierre", async () => {
    await conEntradaFichada();
    const res = await ficharA("16:30", { tipo: "SALIDA" }); // 18:30 en Madrid
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("fuera_de_horario");
    expect(body.motivo).toBe("despues");
    expect(body.error).toContain("Fuera de turno");
    expect(body.error).toContain("solicita el cierre de tu turno");
    expect(body.ajusteHora).toBeUndefined();
  });

  it("dentro del margen de cortesía deja fichar", async () => {
    const res = await ficharA("06:50"); // 08:50 en Madrid, turno a las 09:00
    expect(res.status).toBe(201);
  });

  it("pasado el margen de cortesía ya no deja fichar", async () => {
    // 08:49 en Madrid: un minuto antes de que se abra la ventana de 10 min.
    const res = await ficharA("06:49");
    expect(res.status).toBe(409);
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

  it("con turno solo ayer o mañana (hoy sin cuadrante) deja fichar", async () => {
    // El empleado echa una mano un día que no le toca: hoy no tiene turno
    // publicado, así que no hay con qué comparar y la entrada debe registrarse.
    turnos = [
      { horaInicio: "09:00", horaFin: "17:00", fecha: new Date("2026-07-30T00:00:00Z") },
      { horaInicio: "09:00", horaFin: "17:00", fecha: new Date("2026-08-01T00:00:00Z") },
    ];
    const res = await ficharA("07:50"); // 09:50 en Madrid
    expect(res.status).toBe(201);
  });

  it("el fichaje que sí entra se guarda con su hora real, sin tocar nada", async () => {
    await ficharA("08:00"); // 10:00 en Madrid, dentro del turno
    const { prismaApp } = await import("@/lib/prisma");
    const [args] = (prismaApp.fichaje.create as unknown as { mock: { calls: [{ data: Record<string, unknown> }][] } })
      .mock.calls[0];
    // Nunca se cuadra la hora al turno: la pone la BD con la del fichaje.
    expect(args.data.timestamp).toBeUndefined();
    expect(args.data.nota).toBeUndefined();
  });

  it("mandar el viejo flag de ajuste no salta el bloqueo", async () => {
    // Ticket c726acd0: el atajo del ticket 9e4c2f10 se retiró; un cliente
    // antiguo (o alguien curioso) que siga mandando `ajustarAlTurno` no ficha.
    await conEntradaFichada();
    const res = await ficharA("16:30", { tipo: "SALIDA", ajustarAlTurno: true });
    expect(res.status).toBe(409);
    const { prismaApp } = await import("@/lib/prisma");
    expect(prismaApp.fichaje.create).not.toHaveBeenCalled();
  });

  it("entrar DESPUÉS del cierre se bloquea", async () => {
    const res = await ficharA("16:30", { tipo: "ENTRADA" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("fuera_de_horario");
    expect(body.ajusteHora).toBeUndefined();
    expect(body.error).toContain("Mis Fichajes");
  });

  it("una pausa fuera de la ventana también se bloquea", async () => {
    await conEntradaFichada();
    const res = await ficharA("16:30", { tipo: "PAUSA" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("fuera_de_horario");
    expect(body.ajusteHora).toBeUndefined();
  });
});

/**
 * Cómo se le dice (ticket 9a3f27d0).
 *
 * El mensaje decía "tu empresa no permite fichar fuera del horario del
 * cuadrante". Registrar la jornada es un derecho del trabajador: una frase así,
 * por escrito y en su pantalla, suena a que se le impide cumplirlo —y encima
 * dice lo contrario de lo que hace el sistema, que registra la jornada igual y
 * anota la hora real—. Esto fija que no vuelva.
 */
describe("el aviso de fuera de horario no dice que se le impida fichar", () => {
  const prohibidas = [/no permite fichar/i, /no puedes fichar/i, /tu empresa no/i];

  it("antes del turno: explica qué puede hacer, no lo que su empresa no le deja", async () => {
    const res = await ficharA("05:40");
    const body = await res.json();
    for (const mala of prohibidas) expect(body.error).not.toMatch(mala);
    // Y le dice su horario y dónde pedir el registro.
    expect(body.error).toContain("09:00");
    expect(body.error).toContain("Mis Fichajes");
  });

  it("dice cómo está hecho el fichaje: el margen configurado, con su cifra", async () => {
    // Un dato objetivo del programa se discute mucho peor que "tu empresa no
    // te deja". Y va la cifra de verdad, no una redonda inventada.
    const res = await ficharA("05:40");
    const body = await res.json();
    expect(body.error).toContain("10 minutos antes de entrar");
    expect(body.margen).toBe(10);
  });

  it("sin margen configurado no se habla de minutos de cortesía", async () => {
    cfg.margenFichajeMinutos = 0;
    const res = await ficharA("05:40");
    const body = await res.json();
    expect(body.error).not.toMatch(/pensado para hacerse/);
    expect(body.error).toContain("09:00");
  });

  it("después del turno: lo mismo por el otro lado", async () => {
    await conEntradaFichada();
    const res = await ficharA("16:30", { tipo: "SALIDA" });
    const body = await res.json();
    for (const mala of prohibidas) expect(body.error).not.toMatch(mala);
    expect(body.error).toContain("17:00");
  });
});
