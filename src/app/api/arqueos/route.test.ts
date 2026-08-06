/**
 * GET/POST /api/arqueos — el acumulado de caja de cada punto de venta.
 *
 * Lo que protege (ticket 5f0a92c7):
 *  1. El arqueo se compara contra el efectivo ACUMULADO (lo que ya había +
 *     lo cobrado desde entonces), no contra los cierres de la semana a secas.
 *     Compararlo contra cero descuadraba las 16 tiendas del cliente a la vez.
 *  2. Al declarar, la caja vuelve a cero: el acumulado se ha ido al sobre, y ese
 *     cero es el arranque de la semana siguiente.
 *  3. Una sede cuya caja quedó en incidencia no dice "cuadra": dice que no se
 *     puede saber.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_own", rol: "OWNER", tiendaId: null as string | null, name: "Owner" },
};

/** Día de referencia de los dobles: la fecha de sus turnos y fichajes. */
const HOY = new Date();

/** Una jornada suya: dónde y cuándo (cierre confirmado, turno o fichaje). */
interface Trabajo {
  tiendaId: string | null;
  fecha?: Date;
  timestamp?: Date;
}

const SEDES = [
  { id: "t1", nombre: "NEKSUS CARTAGENA" },
  { id: "t2", nombre: "NEKSUS CC ISLA AZUL" },
];

/** Arranques: Cartagena con saldo, Isla Azul en incidencia. */
const FONDOS = [
  { tiendaId: "t1", fecha: new Date("2026-07-31T00:00:00Z"), importe: 239.32, incidencia: null },
  {
    tiendaId: "t2",
    fecha: new Date("2026-07-31T00:00:00Z"),
    importe: null,
    incidencia: "Caja pendiente de aclarar: sin fondo fiable a esta fecha.",
  },
];

const prismaMock = {
  arqueo: {
    findMany: vi.fn(async () => [] as unknown[]),
    // El arqueo de esa semana, para comprobar que no está ya recogido.
    findUnique: vi.fn(async () => null as { estado: string } | null),
    // Qué semanas tienen arqueos, para poder navegar hasta ellos.
    groupBy: vi.fn(async () => [] as { semana: string; _count: number }[]),
    upsert: vi.fn(async () => ({
      id: "arq1",
      efectivoDeclarado: 719.32,
      efectivoCierres: 480,
      estado: "pendiente",
    })),
  },
  tienda: {
    findMany: vi.fn(async () => SEDES),
    findFirst: vi.fn(async () => SEDES[0]),
    findUnique: vi.fn(async () => SEDES[0]),
  },
  fondoCaja: {
    findMany: vi.fn(async () => FONDOS),
    upsert: vi.fn(async () => ({ id: "f1" })),
  },
  cierreCaja: {
    groupBy: vi.fn(async () => [
      // Cobrado DESPUÉS del arranque del 31/07: cuenta.
      { tiendaId: "t1", fecha: new Date("2026-08-01T00:00:00Z"), _sum: { efectivo: 480 } },
      { tiendaId: "t2", fecha: new Date("2026-08-01T00:00:00Z"), _sum: { efectivo: 300 } },
    ]),
    aggregate: vi.fn(async () => ({ _sum: { efectivo: 480, tarjeta: 0 }, _count: 0 })),
  },
  user: { findMany: vi.fn(async () => [] as unknown[]) },
  usuarioSede: { findMany: vi.fn(async () => [] as { tiendaId: string }[]) },
  cierreTurno: {
    // Las sedes que confirmó como centro de trabajo (ticket 8c05f3e1).
    findMany: vi.fn(async () => [] as Trabajo[]),
  },
  // Dónde ha fichado y qué dice su cuadrante: también son sedes suyas para el
  // arqueo, porque el sobre es de la tienda (ticket 225e527c).
  fichaje: {
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => [] as Trabajo[]),
  },
  turno: {
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => [] as Trabajo[]),
  },
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

interface Fila {
  tiendaId: string;
  sede: string;
  declarado: number | null;
  esperado: number | null;
  sinSaldoMotivo: string | null;
  arranque: { fecha: string; importe: number | null } | null;
  cobradoDesdeArranque: number;
  diferencia: number | null;
  descuadre: boolean;
}

async function get(query = "?semana=2026-W31") {
  const { GET } = await import("./route");
  const { NextRequest } = await import("next/server");
  const res = await GET(new NextRequest(`http://acme.localhost:3000/api/arqueos${query}`));
  return { status: res.status, data: (await res.json()) as { filas: Fila[] } };
}

async function post(body: unknown) {
  const { POST } = await import("./route");
  const { NextRequest } = await import("next/server");
  const res = await POST(
    new NextRequest("http://acme.localhost:3000/api/arqueos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  vi.clearAllMocks();
  prismaMock.arqueo.findMany.mockResolvedValue([]);
  prismaMock.arqueo.findUnique.mockResolvedValue(null);
  prismaMock.arqueo.groupBy.mockResolvedValue([]);
  prismaMock.tienda.findMany.mockResolvedValue(SEDES);
  prismaMock.fondoCaja.findMany.mockResolvedValue(FONDOS);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.usuarioSede.findMany.mockResolvedValue([]);
  prismaMock.cierreTurno.findMany.mockResolvedValue([]);
  prismaMock.fichaje.findMany.mockResolvedValue([]);
  prismaMock.turno.findMany.mockResolvedValue([]);
  sesion.user = { id: "u_own", rol: "OWNER", tiendaId: null, name: "Owner" };
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
  );
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("GET /api/arqueos — acumulado de caja", () => {
  it("el esperado es lo que ya había más lo cobrado desde entonces", async () => {
    const { data } = await get();
    const cartagena = data.filas.find((f) => f.tiendaId === "t1")!;
    expect(cartagena.arranque).toMatchObject({ fecha: "2026-07-31", importe: 239.32 });
    expect(cartagena.cobradoDesdeArranque).toBe(480);
    expect(cartagena.esperado).toBe(719.32);
  });

  it("una caja en incidencia no da un esperado inventado", async () => {
    const { data } = await get();
    const islaAzul = data.filas.find((f) => f.tiendaId === "t2")!;
    expect(islaAzul.esperado).toBeNull();
    expect(islaAzul.sinSaldoMotivo).toBe("arranque_en_incidencia");
    expect(islaAzul.descuadre).toBe(false);
  });

  it("el arranque se busca ANTES del último día arqueado", async () => {
    // El cero que deja el arqueo del domingo lleva la fecha de ese domingo: es
    // el arranque de la semana siguiente, no el de la que se acaba de arquear.
    await get();
    const [args] = prismaMock.fondoCaja.findMany.mock.calls[0] as unknown as [
      { where: { fecha: { lt: Date } } },
    ];
    expect(args.where.fecha.lt.toISOString().slice(0, 10)).toBe("2026-08-02");
  });

  it("con arqueo declarado se enseña el acumulado congelado, no uno recalculado", async () => {
    prismaMock.arqueo.findMany.mockResolvedValue([
      {
        id: "arq1",
        tiendaId: "t1",
        semana: "2026-W31",
        efectivoDeclarado: 719.32,
        efectivoCierres: 480,
        efectivoRecogido: null,
        saldoEsperado: 719.32,
        notas: null,
        estado: "pendiente",
        declaradoEn: new Date("2026-08-02T20:00:00Z"),
        recogidoEn: null,
        declaradoPor: { nombre: "Ana", apellidos: "Ruiz" },
        recogidoPor: null,
      },
    ]);
    const { data } = await get();
    const cartagena = data.filas.find((f) => f.tiendaId === "t1")!;
    expect(cartagena.esperado).toBe(719.32);
    expect(cartagena.diferencia).toBe(0);
    expect(cartagena.descuadre).toBe(false);
  });
});

describe("POST /api/arqueos — declarar deja la caja a cero", () => {
  it("registra un arranque de 0 con la fecha del último día arqueado", async () => {
    const { status } = await post({ semana: "2026-W31", tiendaId: "t1", efectivo: "719,32" });
    expect(status).toBe(200);

    const [args] = prismaMock.fondoCaja.upsert.mock.calls[0] as unknown as [
      {
        where: { tiendaId_fecha: { tiendaId: string; fecha: Date } };
        create: { importe: number; nota: string };
      },
    ];
    expect(args.where.tiendaId_fecha.tiendaId).toBe("t1");
    expect(args.where.tiendaId_fecha.fecha.toISOString().slice(0, 10)).toBe("2026-08-02");
    expect(args.create.importe).toBe(0);
    expect(args.create.nota).toContain("2026-W31");
  });

  it("guarda con qué acumulado se declaró, para que no cambie después", async () => {
    await post({ semana: "2026-W31", tiendaId: "t1", efectivo: "719,32" });
    const [args] = prismaMock.arqueo.upsert.mock.calls[0] as unknown as [
      { create: { saldoEsperado: number | null } },
    ];
    expect(args.create.saldoEsperado).toBe(719.32);
  });

  it("el cero y el arqueo se guardan juntos o no se guarda nada", async () => {
    // Si el arqueo se guardara sin dejar la caja a cero, la semana siguiente
    // arrancaría contando otra vez el dinero que ya está en el sobre.
    await post({ semana: "2026-W31", tiendaId: "t1", efectivo: "719,32" });
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });
});

describe("GET /api/arqueos — quien no tiene sede en su ficha", () => {
  it("opera en la tienda que confirmó hoy al abrir su cierre", async () => {
    // Un correturnos cubriendo en Cartagena: tiene que poder arquear ESA caja.
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: null, name: "Ana" };
    prismaMock.cierreTurno.findMany.mockResolvedValue([{ tiendaId: "t1", fecha: HOY }]);
    const { data } = await get();
    expect((data as unknown as { sinSede?: boolean }).sinSede).toBeUndefined();
    // Se consulta acotado a esa tienda (el doble de Prisma no aplica el where).
    const [args] = prismaMock.tienda.findMany.mock.calls[0] as unknown as [
      { where: { id?: { in: string[] } } },
    ];
    expect(args.where.id?.in).toEqual(["t1"]);
  });

  it("sin nada confirmado, se le pregunta dónde está en vez de dejarlo fuera", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: null, name: "Ana" };
    const { data } = (await get()) as unknown as {
      data: { sinSede: boolean; sedes: { id: string }[]; sugerida: { motivo: string } };
    };
    expect(data.sinSede).toBe(true);
    // Con la lista para elegir: antes solo se le decía que hablara con administración.
    expect(data.sedes.map((s) => s.id)).toEqual(["t1", "t2"]);
    expect(data.sugerida.motivo).toBe("ninguna");
  });

  it("declara el efectivo de la tienda que confirmó, aunque no sea suya", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: null, name: "Ana" };
    prismaMock.cierreTurno.findMany.mockResolvedValue([{ tiendaId: "t1", fecha: HOY }]);
    const { status } = await post({ semana: "2026-W31", efectivo: "719,32" });
    expect(status).toBe(200);
    const [args] = prismaMock.arqueo.upsert.mock.calls[0] as unknown as [
      { where: { tiendaId_semana: { tiendaId: string } } },
    ];
    expect(args.where.tiendaId_semana.tiendaId).toBe("t1");
  });

  it("declara donde está hoy, no donde cubrió hace semanas", async () => {
    // Al ampliarse el alcance a las sedes cubiertas, el sobre que se declara
    // desde el asistente (que no manda tienda) tiene que seguir siendo el de
    // donde está trabajando hoy.
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: null, name: "Ana" };
    prismaMock.cierreTurno.findMany.mockResolvedValue([{ tiendaId: "t1", fecha: HOY }]);
    prismaMock.turno.findMany.mockResolvedValue([
      { tiendaId: "t2", fecha: new Date(HOY.getTime() - 21 * 86_400_000) },
    ]);
    const { status } = await post({ semana: "2026-W31", efectivo: "719,32" });
    expect(status).toBe(200);
    const [args] = prismaMock.arqueo.upsert.mock.calls[0] as unknown as [
      { where: { tiendaId_semana: { tiendaId: string } } },
    ];
    expect(args.where.tiendaId_semana.tiendaId).toBe("t1");
  });

  it("sin tienda confirmada no se declara a ciegas", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: null, name: "Ana" };
    const { status, data } = await post({ semana: "2026-W31", efectivo: "100" });
    expect(status).toBe(409);
    expect(data.code).toBe("sin_sede");
    expect(prismaMock.arqueo.upsert).not.toHaveBeenCalled();
  });
});

/**
 * El sobre es de la SEDE, no del comercial que lo declaró (ticket 225e527c).
 *
 * Quien tiene tienda en su ficha pero esa semana cubre en otra veía solo la
 * suya: el alcance se cortaba en cuanto había una sede propia, así que el sobre
 * de la tienda cubierta le quedaba invisible y no podía ni arquearla ni firmar
 * su recogida.
 */
describe("GET /api/arqueos — las sedes en las que se trabaja, no solo la de la ficha", () => {
  it("suma la sede del cuadrante de esa semana a la de su ficha", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
    prismaMock.usuarioSede.findMany.mockResolvedValue([{ tiendaId: "t1" }]);
    prismaMock.turno.findMany.mockResolvedValue([{ tiendaId: "t2", fecha: HOY }]);

    const { data } = await get();
    const [args] = prismaMock.tienda.findMany.mock.calls[0] as unknown as [
      { where: { id?: { in: string[] } } },
    ];
    expect(args.where.id?.in).toEqual(["t1", "t2"]);
    expect((data as unknown as { sinSede?: boolean }).sinSede).toBeUndefined();
  });

  it("suma la sede donde ha fichado aunque no esté en su cuadrante", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
    prismaMock.usuarioSede.findMany.mockResolvedValue([{ tiendaId: "t1" }]);
    prismaMock.fichaje.findMany.mockResolvedValue([{ tiendaId: "t2", timestamp: HOY }]);

    await get();
    const [args] = prismaMock.tienda.findMany.mock.calls[0] as unknown as [
      { where: { id?: { in: string[] } } },
    ];
    expect(args.where.id?.in).toEqual(["t1", "t2"]);
  });

  it("mira la semana que se está consultando, no solo la de hoy", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
    prismaMock.usuarioSede.findMany.mockResolvedValue([{ tiendaId: "t1" }]);

    await get("?semana=2020-W10");
    const [args] = prismaMock.turno.findMany.mock.calls[0] as unknown as [
      { where: { OR: { fecha: { gte: Date; lte: Date } }[] } },
    ];
    // Además del periodo reciente, el de la semana pedida.
    expect(
      args.where.OR.some(
        (r) =>
          r.fecha.gte.toISOString().slice(0, 10) === "2020-03-02" &&
          r.fecha.lte.toISOString().slice(0, 10) === "2020-03-08",
      ),
    ).toBe(true);
  });

  it("sigue sin ver las sedes en las que no trabaja", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
    prismaMock.usuarioSede.findMany.mockResolvedValue([{ tiendaId: "t1" }]);

    await get();
    const [args] = prismaMock.tienda.findMany.mock.calls[0] as unknown as [
      { where: { id?: { in: string[] } } },
    ];
    expect(args.where.id?.in).toEqual(["t1"]);
  });
});

/**
 * Encontrar los arqueos ya hechos (ticket 5a71fe28).
 *
 * El arqueo se prepara el ÚLTIMO día de la semana, así que el lunes siguiente
 * esta pantalla abre en una semana vacía. Pasó de verdad: 14 arqueos declarados
 * el sábado y el domingo, y el lunes el cliente no encontraba ninguno.
 */
describe("GET /api/arqueos — dónde están los arqueos ya hechos", () => {
  it("dice qué semanas tienen arqueos, la más reciente primero", async () => {
    prismaMock.arqueo.groupBy.mockResolvedValue([
      { semana: "2026-W31", _count: 14 },
      { semana: "2026-W30", _count: 1 },
    ]);
    const { data } = (await get("?semana=2026-W32")) as unknown as {
      data: { semanasConArqueos: { semana: string; texto: string; arqueos: number }[] };
    };
    expect(data.semanasConArqueos[0]).toMatchObject({ semana: "2026-W31", arqueos: 14 });
    // Y con su texto legible, que es lo que se pinta en el enlace.
    expect(data.semanasConArqueos[0]?.texto).toContain("de julio");
  });

  it("sin ningún arqueo en el sistema devuelve una lista vacía, no un error", async () => {
    prismaMock.arqueo.groupBy.mockResolvedValue([]);
    const { status, data } = (await get()) as unknown as {
      status: number;
      data: { semanasConArqueos: unknown[] };
    };
    expect(status).toBe(200);
    expect(data.semanasConArqueos).toEqual([]);
  });
});
