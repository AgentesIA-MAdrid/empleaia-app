/**
 * Ticket 25c81b6b: no se ficha antes ni después del horario del cuadrante.
 *
 * Verifica que:
 *  1. Con el interruptor apagado, fichar fuera de horario sigue funcionando.
 *  2. Encendido y fuera del turno → 409 `fuera_de_horario` con el horario del
 *     turno y la hora a la que se ajustaría el fichaje.
 *  3. Dentro del turno (o del margen de cortesía) → 201.
 *  4. Sin turno publicado no se comprueba nada: el fichaje entra.
 *  5. Ticket 9e4c2f10: si el empleado acepta, el fichaje se registra en el acto
 *     con la hora del turno y con la hora real del intento anotada. Ya no se
 *     abre una solicitud que alguien tenga que aprobar.
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
async function ficharA(
  horaMadrid: string,
  extra: { ajustarAlTurno?: boolean; nota?: string; tipo?: string } = {},
) {
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

  it("la salida después del turno responde 409 con el ajuste al fin", async () => {
    await conEntradaFichada();
    const res = await ficharA("16:30", { tipo: "SALIDA" }); // 18:30 en Madrid
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("fuera_de_horario");
    expect(body.motivo).toBe("despues");
    expect(body.ajustable).toBe(true);
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

  it("aceptando el ajuste, el fichaje se registra con la hora del turno", async () => {
    // Ticket 9e4c2f10: intenta a las 18:30 de Madrid y acepta; la entrada se
    // guarda a las 17:00 (fin del turno), sin pasar por ninguna aprobación.
    await conEntradaFichada();
    const res = await ficharA("16:30", { tipo: "SALIDA", ajustarAlTurno: true });
    expect(res.status).toBe(201);
    const { prismaApp } = await import("@/lib/prisma");
    const [args] = (prismaApp.fichaje.create as unknown as { mock: { calls: [{ data: Record<string, unknown> }][] } })
      .mock.calls[0];
    expect((args.data.timestamp as Date).toISOString()).toBe("2026-07-31T15:00:00.000Z");
  });

  it("el fichaje ajustado deja escrita la hora real del intento", async () => {
    await conEntradaFichada();
    const res = await ficharA("16:30", { tipo: "SALIDA", ajustarAlTurno: true });
    expect(res.status).toBe(201);
    const { prismaApp } = await import("@/lib/prisma");
    const [args] = (prismaApp.fichaje.create as unknown as { mock: { calls: [{ data: Record<string, unknown> }][] } })
      .mock.calls[0];
    const nota = String(args.data.nota);
    // Sin esto no habría forma de auditar que la jornada registrada no coincide
    // con el minuto en que se pulsó el botón.
    expect(nota).toContain("se registra a las 17:00");
    expect(nota).toContain("el intento fue a las 18:30");
  });

  it("el motivo que escribe el empleado se conserva detrás del ajuste", async () => {
    await conEntradaFichada();
    await ficharA("16:30", { tipo: "SALIDA", ajustarAlTurno: true, nota: "Estaba cerrando una venta" });
    const { prismaApp } = await import("@/lib/prisma");
    const [args] = (prismaApp.fichaje.create as unknown as { mock: { calls: [{ data: Record<string, unknown> }][] } })
      .mock.calls[0];
    expect(String(args.data.nota)).toContain("Estaba cerrando una venta");
  });

  it("dentro del turno, el flag no cambia nada: se registra a su hora", async () => {
    await ficharA("08:00", { ajustarAlTurno: true });
    const { prismaApp } = await import("@/lib/prisma");
    const [args] = (prismaApp.fichaje.create as unknown as { mock: { calls: [{ data: Record<string, unknown> }][] } })
      .mock.calls[0];
    // Sin ajuste no se toca el timestamp: lo pone la BD con la hora real.
    expect(args.data.timestamp).toBeUndefined();
    expect(args.data.nota).toBeUndefined();
  });

  it("entrar DESPUÉS del cierre se bloquea: no se cuadra a una hora ya pasada", async () => {
    // Ticket b7d3e5a9: ajustar esto dejaría la entrada registrada a las 17:00,
    // la hora en que su turno ya había acabado.
    const res = await ficharA("16:30", { tipo: "ENTRADA" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("fuera_de_horario");
    expect(body.ajustable).toBe(false);
    expect(body.ajusteHora).toBeUndefined();
    expect(body.error).toContain("Mis Fichajes");
  });

  it("y aceptando el ajuste tampoco entra: el bloqueo no se puede saltar", async () => {
    const res = await ficharA("16:30", { tipo: "ENTRADA", ajustarAlTurno: true });
    expect(res.status).toBe(409);
    expect((await res.json()).ajustable).toBe(false);
  });

  it("salir después del cierre sí se ajusta", async () => {
    await conEntradaFichada();
    const res = await ficharA("16:30", { tipo: "SALIDA", ajustarAlTurno: true });
    expect(res.status).toBe(201);
  });

  it("una pausa fuera de la ventana se ajusta al borde", async () => {
    await conEntradaFichada();
    const res = await ficharA("16:30", { tipo: "PAUSA" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ajustable).toBe(true);
    expect(body.ajusteHora).toBe("17:00");
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
    // Y ofrece la salida real: registrar a la hora del turno.
    expect(body.error).toContain("09:00");
    expect(body.ajustable).toBe(true);
  });

  it("dice cómo está hecho el fichaje: el margen configurado, con su cifra", async () => {
    // Un dato objetivo del programa se discute mucho peor que "tu empresa no
    // te deja". Y va la cifra de verdad, no una redonda inventada.
    const res = await ficharA("05:40");
    const body = await res.json();
    expect(body.error).toContain("15 minutos antes de entrar");
    expect(body.margen).toBe(15);
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
