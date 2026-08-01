/**
 * GET /api/cierre-turno/progreso — los tres objetivos del paso 2.
 *
 * Lo que protege (ticket 8f2a04e1):
 *  1. Los tres bloques no se mezclan: el suyo, el de su tienda y el que el
 *     operador impone a su tienda, cada uno con sus cifras.
 *  2. La sede va con su nombre, no como "tu sede".
 *  3. Salen TODOS los grupos del catálogo, con objetivo o sin él: enseñar solo
 *     lo vendido escondía justo lo que va a cero.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sesion = {
  user: { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1" as string | null, name: "Ana" },
};

const CATALOGO = [
  {
    id: "art_fibra",
    nombre: "Fibra General",
    categoria: "Particular",
    subcategoria: "FFTH",
    precio: null,
    cuentaParaObjetivos: true,
    orden: 0,
  },
  {
    id: "art_pos",
    nombre: "Pospago",
    categoria: "Particular",
    subcategoria: "Pospago",
    precio: null,
    cuentaParaObjetivos: true,
    orden: 1,
  },
];

/** Objetivos del mes: el suyo de FFTH, el de la tienda y el del operador. */
const OBJETIVOS = [
  { id: "o_ana", mes: "2026-07", userId: "u_ana", tiendaId: null, articuloId: null, categoria: null, subcategoria: "FFTH", fuente: "propio", cantidad: 4 },
  { id: "o_sede", mes: "2026-07", userId: null, tiendaId: "t1", articuloId: null, categoria: null, subcategoria: "FFTH", fuente: "propio", cantidad: 10 },
  { id: "o_tmt", mes: "2026-07", userId: null, tiendaId: "t1", articuloId: null, categoria: null, subcategoria: "FFTH", fuente: "tmt", cantidad: 20 },
];

/** Dos cierres del mes: 2 fibras de Ana y 3 de un compañero de su tienda. */
const CIERRES = [
  { id: "c_ana", userId: "u_ana", tiendaId: "t1", fecha: new Date("2026-07-15T00:00:00Z") },
  { id: "c_luis", userId: "u_luis", tiendaId: "t1", fecha: new Date("2026-07-16T00:00:00Z") },
];

/**
 * El doble respeta el filtro de la consulta (sede y/o comercial): sin eso, un
 * test sobre "de qué tienda son estas ventas" no probaría nada.
 */
type WhereCierres = {
  AND?: ({ tiendaId?: string } | { tiendaId?: { in: string[] } })[];
  userId?: string;
};
function cierresFiltrados(args?: { where?: WhereCierres }) {
  const where = args?.where ?? {};
  return CIERRES.filter((c) => {
    if (where.userId && c.userId !== where.userId) return false;
    for (const cond of where.AND ?? []) {
      const t = (cond as { tiendaId?: string }).tiendaId;
      if (typeof t === "string" && c.tiendaId !== t) return false;
    }
    return true;
  });
}

const prismaMock = {
  objetivoVenta: { findMany: vi.fn(async () => OBJETIVOS) },
  cierreTurno: {
    findMany: vi.fn(async (args?: { where?: WhereCierres }) => cierresFiltrados(args)),
    // La sede que confirmó al empezar el cierre de hoy. null = aún no ha dicho
    // nada y vale la de su ficha.
    findUnique: vi.fn(async () => null as { tiendaId: string | null } | null),
  },
  cierreTurnoVenta: {
    groupBy: vi.fn(async () => [
      { cierreId: "c_ana", articuloId: "art_fibra", _sum: { cantidad: 2 } },
      { cierreId: "c_luis", articuloId: "art_fibra", _sum: { cantidad: 3 } },
    ]),
  },
  articuloVenta: { findMany: vi.fn(async () => CATALOGO) },
  tienda: { findUnique: vi.fn(async () => ({ nombre: "NEKSUS ALCALA MARQUES" })) },
  configuracionEmpresa: { findUnique: vi.fn(async () => ({ ventasPreciosActivos: false })) },
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

interface Bloque {
  vendido: number;
  objetivo: number | null;
  consecucion: number | null;
  grupos: { grupo: string; vendido: number; objetivo: number | null; consecucion: number | null }[];
}

async function get(query = "?mes=2026-07") {
  const { GET } = await import("./route");
  const { NextRequest } = await import("next/server");
  const res = await GET(
    new NextRequest(`http://acme.localhost:3000/api/cierre-turno/progreso${query}`),
  );
  return {
    status: res.status,
    data: (await res.json()) as {
      sedeNombre: string | null;
      propio: Bloque;
      sede: Bloque | null;
      sedeTmt: Bloque | null;
      porArticulo: { nombre: string; vendido: number }[];
    },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
  prismaMock.objetivoVenta.findMany.mockResolvedValue(OBJETIVOS);
  prismaMock.tienda.findUnique.mockResolvedValue({ nombre: "NEKSUS ALCALA MARQUES" });
  prismaMock.cierreTurno.findUnique.mockResolvedValue(null);
  prismaMock.cierreTurno.findMany.mockImplementation(async (args?: { where?: WhereCierres }) =>
    cierresFiltrados(args),
  );
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("GET /api/cierre-turno/progreso", () => {
  it("da el nombre de la tienda, no 'tu sede'", async () => {
    const { data } = await get();
    expect(data.sedeNombre).toBe("NEKSUS ALCALA MARQUES");
  });

  it("los tres objetivos van por separado y con sus cifras", async () => {
    const { data } = await get();
    // Lo suyo: 2 fibras de 4.
    expect(data.propio).toMatchObject({ vendido: 2, objetivo: 4, consecucion: 50 });
    // Su tienda: las 5 de la tienda (2 suyas + 3 del compañero) de 10.
    expect(data.sede).toMatchObject({ vendido: 5, objetivo: 10, consecucion: 50 });
    // El operador aprieta más con las MISMAS ventas: 5 de 20.
    expect(data.sedeTmt).toMatchObject({ vendido: 5, objetivo: 20, consecucion: 25 });
  });

  it("cada bloque trae TODOS los grupos del catálogo, con objetivo o sin él", async () => {
    const { data } = await get();
    expect(data.propio.grupos.map((g) => g.grupo)).toEqual(["FFTH", "Pospago"]);
    // Pospago no tiene objetivo ni ventas, y sale igual: es lo que va a cero.
    expect(data.propio.grupos[1]).toMatchObject({
      grupo: "Pospago",
      vendido: 0,
      objetivo: null,
      consecucion: null,
    });
    expect(data.sedeTmt?.grupos[0]).toMatchObject({ grupo: "FFTH", vendido: 5, objetivo: 20 });
  });

  it("sin sede asignada no se inventa una tienda", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: null, name: "Ana" };
    const { data } = await get();
    expect(data.sedeNombre).toBeNull();
    expect(data.sede).toBeNull();
    expect(data.sedeTmt).toBeNull();
    // Lo suyo se sigue viendo.
    expect(data.propio.vendido).toBe(2);
  });

  it("manda la sede que confirmó hoy, no la de su ficha", async () => {
    // Un correturnos sin sede en la ficha que confirma que está en t9: los dos
    // cuadros de tienda tienen que ser los de t9 (ticket 8c05f3e1).
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: null, name: "Ana" };
    prismaMock.cierreTurno.findUnique.mockResolvedValue({ tiendaId: "t9" });
    prismaMock.tienda.findUnique.mockResolvedValue({ nombre: "YOIGO CC LA VAGUADA" });
    prismaMock.objetivoVenta.findMany.mockResolvedValue([
      { id: "o_t9", mes: "2026-07", userId: null, tiendaId: "t9", articuloId: null, categoria: null, subcategoria: "FFTH", fuente: "propio", cantidad: 10 },
    ]);
    const { data } = await get();
    expect(data.sedeNombre).toBe("YOIGO CC LA VAGUADA");
    expect(data.sede?.objetivo).toBe(10);
    // Y los objetivos se piden para esa tienda, no para la de la ficha.
    const [args] = prismaMock.objetivoVenta.findMany.mock.calls[0] as unknown as [
      { where: { OR: unknown[] } },
    ];
    expect(args.where.OR).toContainEqual({ tiendaId: "t9" });
  });

  it("el desglose por producto es solo lo que ha vendido él", async () => {
    const { data } = await get();
    // Una fila, la del producto que ha vendido: las 3 del compañero no son suyas
    // y "Pospago", que no ha vendido nadie, no ensucia la lista.
    expect(data.porArticulo).toHaveLength(1);
    expect(data.porArticulo[0]).toMatchObject({ nombre: "Fibra General", vendido: 2 });
  });

  it("un mes mal escrito se rechaza", async () => {
    expect((await get("?mes=2026-13")).status).toBe(400);
  });
});

/**
 * Dónde cuenta cada venta cuando alguien cubre en otra tienda (ticket 4e81b6c3).
 *
 * La regla del cliente, en sus palabras: "si un correturnos cubre horario en una
 * tienda, las ventas de ese día son de esa tienda; y luego todas suman para su
 * cometido individual".
 */
describe("GET /api/cierre-turno/progreso — cubrir en otra tienda", () => {
  /** Ana vende 2 en su sede (t1) y 3 el domingo cubriendo en otra (t9). */
  const CIERRES_CUBRIENDO = [
    { id: "c_ana_t1", userId: "u_ana", tiendaId: "t1", fecha: new Date("2026-07-15T00:00:00Z") },
    { id: "c_ana_t9", userId: "u_ana", tiendaId: "t9", fecha: new Date("2026-07-19T00:00:00Z") },
    { id: "c_luis", userId: "u_luis", tiendaId: "t1", fecha: new Date("2026-07-16T00:00:00Z") },
  ];

  beforeEach(() => {
    prismaMock.cierreTurno.findMany.mockImplementation(async (args?: { where?: WhereCierres }) => {
      const where = args?.where ?? {};
      return CIERRES_CUBRIENDO.filter((c) => {
        if (where.userId && c.userId !== where.userId) return false;
        for (const cond of where.AND ?? []) {
          const t = (cond as { tiendaId?: string }).tiendaId;
          if (typeof t === "string" && c.tiendaId !== t) return false;
        }
        return true;
      });
    });
    prismaMock.cierreTurnoVenta.groupBy.mockResolvedValue([
      { cierreId: "c_ana_t1", articuloId: "art_fibra", _sum: { cantidad: 2 } },
      { cierreId: "c_ana_t9", articuloId: "art_fibra", _sum: { cantidad: 3 } },
      { cierreId: "c_luis", articuloId: "art_fibra", _sum: { cantidad: 4 } },
    ]);
  });

  it("su objetivo individual suma lo que vendió en LAS DOS tiendas", () => {
    // 2 en la suya + 3 cubriendo = 5. Antes solo contaban las de la tienda en la
    // que estuviera hoy, así que un domingo fuera desaparecía de su objetivo.
    return get().then(({ data }) => {
      expect(data.propio.vendido).toBe(5);
    });
  });

  it("el objetivo de la tienda cuenta solo lo vendido ALLÍ", async () => {
    // En t1: 2 de Ana + 4 de Luis. Las 3 que Ana hizo cubriendo en t9 no son de
    // esta tienda y no la ayudan a llegar a su objetivo.
    const { data } = await get();
    expect(data.sede?.vendido).toBe(6);
  });

  it("el desglose por producto es el suyo entero, cubra donde cubra", async () => {
    const { data } = await get();
    expect(data.porArticulo).toEqual([expect.objectContaining({ nombre: "Fibra General", vendido: 5 })]);
  });

  it("las ventas de la sede se piden por sede y las suyas por persona", async () => {
    await get();
    const wheres = prismaMock.cierreTurno.findMany.mock.calls.map(
      (c) => (c[0] as { where?: WhereCierres } | undefined)?.where ?? {},
    );
    // Una consulta acotada a él sin filtro de tienda…
    expect(wheres.some((w) => w.userId === "u_ana" && !w.AND)).toBe(true);
    // …y otra acotada a la tienda sin filtro de persona.
    expect(
      wheres.some(
        (w) => !w.userId && (w.AND ?? []).some((c) => (c as { tiendaId?: string }).tiendaId === "t1"),
      ),
    ).toBe(true);
  });
});
