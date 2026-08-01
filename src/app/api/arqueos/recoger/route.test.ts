/**
 * POST /api/arqueos/recoger — firma de la recogida de efectivo.
 *
 * Es dinero cambiando de manos, así que lo que se protege aquí es:
 *  1. Sin autorización expresa no se firma (el rol no basta).
 *  2. Sin PIN configurado tampoco.
 *  3. PIN incorrecto → 401 y suma un intento fallido.
 *  4. Al agotar los intentos → 429 y bloqueo temporal guardado.
 *  5. Con el bloqueo vivo no se comprueba ni el PIN.
 *  6. Acertando: el arqueo queda recogido, se congela `efectivoCierres` y se
 *     limpian los intentos.
 *  7. No se puede recoger más de lo declarado ni recoger dos veces.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

const PIN = "4729";
let PIN_HASH = "";

const sesion = { user: { id: "u_jefe", rol: "MANAGER", tiendaId: "t1", name: "Jefe" } };

const yo = {
  id: "u_jefe",
  nombre: "Marta",
  apellidos: "Ruiz",
  activo: true,
  puedeRecogerEfectivo: true,
  pinRecogidaHash: null as string | null,
  pinRecogidaIntentos: 0,
  pinRecogidaBloqueoHasta: null as Date | null,
};

const arqueo = {
  id: "arq1",
  semana: "2026-W31",
  tiendaId: "t1",
  estado: "pendiente",
  efectivoDeclarado: 500,
  /** El acumulado con el que se declaró el domingo (ticket 5f0a92c7). */
  saldoEsperado: 480 as number | null,
  tienda: { id: "t1", nombre: "Centro" },
};

const prismaMock = {
  user: {
    findUnique: vi.fn(async () => yo as unknown),
    update: vi.fn(async () => ({}) as unknown),
  },
  arqueo: {
    findMany: vi.fn(async () => [arqueo] as unknown[]),
    update: vi.fn(async () => ({}) as unknown),
  },
  // Alcance de sedes de quien opera la pantalla.
  usuarioSede: { findMany: vi.fn(async () => [] as { tiendaId: string }[]) },
  cierreTurno: { findUnique: vi.fn(async () => null as { tiendaId: string | null } | null) },
  tienda: {
    findMany: vi.fn(async () => [{ id: "t1" }]),
    findFirst: vi.fn(async () => ({ id: "t1" }) as { id: string } | null),
  },
  cierreCaja: {
    groupBy: vi.fn(async () => [
      { tiendaId: "t1", _sum: { efectivo: 480, tarjeta: 300 }, _count: 5 },
    ] as unknown[]),
  },
  configuracionEmpresa: { findUnique: vi.fn(async () => ({ descuadreUmbral: 1 })) },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
};

const notificado = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prismaApp: prismaMock,
  prismaMaster: {},
  prismaRuntime: {},
  prismaQuotaWriter: {},
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sesion) }));

vi.mock("@/lib/cierre-turno/notify", () => ({
  notifyRecogidaEfectivo: (ctx: unknown) => {
    notificado(ctx);
    return Promise.resolve();
  },
}));

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

async function recoger(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const { NextRequest } = await import("next/server");
  return POST(
    new NextRequest("http://acme.localhost:3000/api/arqueos/recoger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Último `data` con el que se actualizó el usuario. */
function ultimoUpdateUsuario(): Record<string, unknown> {
  const calls = prismaMock.user.update.mock.calls as unknown as [{ data: Record<string, unknown> }][];
  return calls[calls.length - 1][0].data;
}

beforeEach(async () => {
  vi.clearAllMocks();
  if (!PIN_HASH) PIN_HASH = await bcrypt.hash(PIN, 10);
  yo.puedeRecogerEfectivo = true;
  yo.pinRecogidaHash = PIN_HASH;
  yo.pinRecogidaIntentos = 0;
  yo.pinRecogidaBloqueoHasta = null;
  arqueo.estado = "pendiente";
  arqueo.saldoEsperado = 480;
  prismaMock.user.findUnique.mockResolvedValue(yo);
  prismaMock.arqueo.findMany.mockResolvedValue([arqueo]);
  prismaMock.usuarioSede.findMany.mockResolvedValue([]);
  prismaMock.tienda.findFirst.mockResolvedValue({ id: "t1" });
  prismaMock.cierreTurno.findUnique.mockResolvedValue(null);
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("POST /api/arqueos/recoger", () => {
  it("sin autorización expresa no se firma, aunque seas coordinador", async () => {
    yo.puedeRecogerEfectivo = false;
    const res = await recoger({ arqueoId: "arq1", pin: PIN });
    expect(res.status).toBe(403);
    expect(prismaMock.arqueo.update).not.toHaveBeenCalled();
  });

  it("autorizado pero sin PIN asignado no puede firmar", async () => {
    yo.pinRecogidaHash = null;
    const res = await recoger({ arqueoId: "arq1", pin: PIN });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("sin_pin");
  });

  it("PIN incorrecto: 401 y suma un intento", async () => {
    const res = await recoger({ arqueoId: "arq1", pin: "0000" });
    expect(res.status).toBe(401);
    expect(ultimoUpdateUsuario()).toMatchObject({ pinRecogidaIntentos: 1 });
    expect(prismaMock.arqueo.update).not.toHaveBeenCalled();
  });

  it("al agotar los intentos bloquea y devuelve 429", async () => {
    yo.pinRecogidaIntentos = 4; // el quinto fallo agota
    const res = await recoger({ arqueoId: "arq1", pin: "0000" });
    expect(res.status).toBe(429);
    const data = ultimoUpdateUsuario();
    expect(data.pinRecogidaIntentos).toBe(0);
    expect(data.pinRecogidaBloqueoHasta).toBeInstanceOf(Date);
  });

  it("con el bloqueo vivo no se llega ni a comprobar el PIN", async () => {
    yo.pinRecogidaBloqueoHasta = new Date(Date.now() + 10 * 60_000);
    const res = await recoger({ arqueoId: "arq1", pin: PIN });
    expect(res.status).toBe(429);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.arqueo.update).not.toHaveBeenCalled();
  });

  it("un arqueo sin acumulado guardado no inventa una diferencia", async () => {
    // Arqueos anteriores a esta cuenta, o sedes sin punto de partida: se firma
    // la recogida igual, pero no se dice que cuadra ni que descuadra.
    arqueo.saldoEsperado = null;
    const res = await recoger({ arqueoId: "arq1", pin: PIN });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { diferencia: number | null; descuadre: boolean };
    expect(data.diferencia).toBeNull();
    expect(data.descuadre).toBe(false);
  });

  it("un bloqueo ya vencido no estorba", async () => {
    yo.pinRecogidaBloqueoHasta = new Date(Date.now() - 60_000);
    const res = await recoger({ arqueoId: "arq1", pin: PIN });
    expect(res.status).toBe(200);
  });

  it("con el PIN correcto firma, congela lo comparado y limpia los intentos", async () => {
    yo.pinRecogidaIntentos = 2;
    const res = await recoger({ arqueoId: "arq1", pin: PIN });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { recogido: number; segunCierres: number; diferencia: number; descuadre: boolean };
    expect(data.recogido).toBe(500);
    expect(data.segunCierres).toBe(480);
    // 500 en el sobre frente a 480 acumulados en caja: 20 € de más, es descuadre.
    expect(data.diferencia).toBe(20);
    expect(data.descuadre).toBe(true);

    const update = prismaMock.arqueo.update.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(update[0].data).toMatchObject({
      estado: "recogido",
      recogidoPorId: "u_jefe",
      efectivoRecogido: 500,
      efectivoCierres: 480,
    });
    expect(ultimoUpdateUsuario()).toMatchObject({
      pinRecogidaIntentos: 0,
      pinRecogidaBloqueoHasta: null,
    });
    expect(notificado).toHaveBeenCalledTimes(1);
  });

  it("puede recoger menos de lo declarado (deja fondo de caja)", async () => {
    const res = await recoger({ arqueoId: "arq1", pin: PIN, efectivoRecogido: "450,50" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { recogido: number }).recogido).toBe(450.5);
  });

  it("no puede recoger más de lo declarado", async () => {
    const res = await recoger({ arqueoId: "arq1", pin: PIN, efectivoRecogido: 600 });
    expect(res.status).toBe(400);
    expect(prismaMock.arqueo.update).not.toHaveBeenCalled();
  });

  it("un arqueo ya recogido no se firma dos veces", async () => {
    arqueo.estado = "recogido";
    const res = await recoger({ arqueoId: "arq1", pin: PIN });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("ya_recogido");
  });

  it("un arqueo que no existe da 404", async () => {
    prismaMock.arqueo.findMany.mockResolvedValue([]);
    const res = await recoger({ arqueoId: "fantasma", pin: PIN });
    expect(res.status).toBe(404);
  });
});

/**
 * Entrega de varios sobres de una vez (ticket 6d24af90): el responsable no pasa
 * cada semana y se encuentra dos o tres esperando.
 */
describe("POST /api/arqueos/recoger — varios sobres y firma de otra persona", () => {
  const otroSobre = {
    id: "arq2",
    semana: "2026-W30",
    tiendaId: "t1",
    estado: "pendiente",
    efectivoDeclarado: 320,
    saldoEsperado: 320 as number | null,
    tienda: { id: "t1", nombre: "Centro" },
  };

  it("firma los dos sobres con un solo PIN y devuelve el total", async () => {
    prismaMock.arqueo.findMany.mockResolvedValue([arqueo, otroSobre]);
    const res = await recoger({ arqueoIds: ["arq1", "arq2"], pin: PIN });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { sobres: number; total: number };
    expect(data.sobres).toBe(2);
    expect(data.total).toBe(820);
    expect(prismaMock.arqueo.update).toHaveBeenCalledTimes(2);
  });

  it("si uno de ellos ya estaba recogido, no se firma ninguno", async () => {
    // Dos personas mirando la misma pantalla: el segundo no debe pisar al primero.
    prismaMock.arqueo.findMany.mockResolvedValue([arqueo, { ...otroSobre, estado: "recogido" }]);
    const res = await recoger({ arqueoIds: ["arq1", "arq2"], pin: PIN });
    expect(res.status).toBe(409);
    expect(prismaMock.arqueo.update).not.toHaveBeenCalled();
  });

  it("firma quien recoge de verdad, no quien tiene la sesión abierta", async () => {
    // El móvil lo lleva el comercial; el dinero se lo lleva el responsable.
    const responsable = {
      id: "u_resp",
      nombre: "Silvia",
      apellidos: "Carrion",
      activo: true,
      puedeRecogerEfectivo: true,
      pinRecogidaHash: PIN_HASH,
      pinRecogidaIntentos: 0,
      pinRecogidaBloqueoHasta: null as Date | null,
    };
    prismaMock.user.findUnique.mockResolvedValue(responsable);
    const res = await recoger({ arqueoIds: ["arq1"], recogidoPorId: "u_resp", pin: PIN });
    expect(res.status).toBe(200);
    const [args] = prismaMock.arqueo.update.mock.calls[0] as unknown as [
      { data: { recogidoPorId: string } },
    ];
    expect(args.data.recogidoPorId).toBe("u_resp");
  });

  it("no se puede firmar en nombre de alguien no autorizado", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u_x",
      nombre: "Luis",
      apellidos: "Gil",
      activo: true,
      puedeRecogerEfectivo: false,
      pinRecogidaHash: PIN_HASH,
      pinRecogidaIntentos: 0,
      pinRecogidaBloqueoHasta: null,
    });
    const res = await recoger({ arqueoIds: ["arq1"], recogidoPorId: "u_x", pin: PIN });
    expect(res.status).toBe(403);
    expect(prismaMock.arqueo.update).not.toHaveBeenCalled();
  });

  it("un sobre de una sede que no es suya no se firma", async () => {
    prismaMock.arqueo.findMany.mockResolvedValue([
      { ...otroSobre, tiendaId: "t_otra", tienda: { id: "t_otra", nombre: "Otra" } },
    ]);
    const res = await recoger({ arqueoIds: ["arq2"], pin: PIN });
    expect(res.status).toBe(403);
    expect(prismaMock.arqueo.update).not.toHaveBeenCalled();
  });

  it("con varios sobres no se admite un importe parcial", async () => {
    // No se sabría a cuál de ellos aplicárselo.
    prismaMock.arqueo.findMany.mockResolvedValue([arqueo, otroSobre]);
    const res = await recoger({ arqueoIds: ["arq1", "arq2"], pin: PIN, efectivoRecogido: "100" });
    expect(res.status).toBe(400);
    expect(prismaMock.arqueo.update).not.toHaveBeenCalled();
  });

  it("sin ningún sobre elegido no se firma nada", async () => {
    const res = await recoger({ arqueoIds: [], pin: PIN });
    expect(res.status).toBe(400);
  });
});
