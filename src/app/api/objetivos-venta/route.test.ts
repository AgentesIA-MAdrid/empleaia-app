/**
 * /api/objetivos-venta — permisos y guardado.
 *
 * Se invoca al handler directamente con un NextRequest (sin levantar HTTP) y
 * con Prisma mockeado, como en `src/app/api/fichajes/checklist.test.ts`.
 *
 * Lo que se protege aquí:
 *  1. Un comercial no entra: los objetivos son de administración y coordinación.
 *  2. El coordinador ve las sedes que lleva y en modo lectura; si pide una que
 *     no es suya, no se le sirve.
 *  3. Fijar un objetivo NO usa `upsert` sobre la clave única con NULLs (en
 *     Postgres dos NULL no son iguales y crearía duplicados): busca primero.
 *  4. Cantidad 0 borra el objetivo en vez de dejar un cero que parece un
 *     objetivo real de cero unidades.
 *  5. El tercer ámbito —los grupos de objetivos, ticket ff5ab304— tiene su
 *     propia parrilla, no se mezcla con las otras dos y el coordinador solo ve
 *     los grupos que caen dentro de sus sedes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { columnaSubgrupo } from "@/lib/cierre-turno/objetivos";

const sesion = {
  user: { id: "u_owner", rol: "OWNER", tiendaId: null as string | null, name: "Owner" },
};

const objetivosExistentes: {
  id: string;
  mes: string;
  userId: string | null;
  tiendaId: string | null;
  grupoId?: string | null;
  articuloId: string | null;
  categoria?: string | null;
  subcategoria?: string | null;
  cantidad: number;
}[] = [];

/** Grupos de objetivos del tenant de mentira (ticket ff5ab304). */
const gruposExistentes: {
  id: string;
  nombre: string;
  activo?: boolean;
  miembros: { userId: string | null; tiendaId: string | null }[];
}[] = [];

/** Catálogo del tenant de mentira: un producto que cuenta y otro que no. */
const catalogo = [
  {
    id: "art_fibra",
    nombre: "Alta de fibra",
    categoria: "Telefonía",
    subcategoria: "Hogar",
    precio: null,
    cuentaParaObjetivos: true,
  },
  {
    id: "art_funda",
    nombre: "Funda",
    categoria: "Accesorios",
    subcategoria: "Fundas",
    precio: null,
    cuentaParaObjetivos: false,
  },
];

/**
 * El grupo de productos con objetivo es la subcategoría, con su categoría
 * delante para no confundir dos que se llamen igual (ticket 234c6b0f).
 */
/**
 * El grupo con objetivo es la subcategoría y solo la subcategoría: la categoría
 * de la que cuelga no lo identifica (ticket 528694fa).
 */
const HOGAR = { subcategoria: "Hogar" };
const COLUMNA_HOGAR = columnaSubgrupo(HOGAR);

const prismaMock = {
  objetivoVenta: {
    findMany: vi.fn(async () => objetivosExistentes),
    findFirst: vi.fn(async () => null as unknown),
    findUnique: vi.fn(async () => null as unknown),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "obj_nuevo", ...data })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "obj_1", ...data })),
    delete: vi.fn(async () => ({ id: "obj_1" })),
  },
  grupoObjetivo: {
    findMany: vi.fn(async () => gruposExistentes),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const g = gruposExistentes.find((x) => x.id === where.id);
      return g ? { id: g.id, activo: g.activo !== false } : null;
    }),
  },
  cierreTurno: { findMany: vi.fn(async () => [] as unknown[]) },
  cierreTurnoVenta: { groupBy: vi.fn(async () => [] as unknown[]) },
  articuloVenta: {
    findMany: vi.fn(async () => catalogo),
    findUnique: vi.fn(async () => ({
      id: "art_fibra",
      nombre: "Alta de fibra",
      cuentaParaObjetivos: true,
    })),
    // Comprobación de que el grupo existe en el catálogo activo.
    findFirst: vi.fn(async () => ({ id: "art_fibra" }) as unknown),
  },
  tienda: {
    findMany: vi.fn(async () => [{ id: "t1", nombre: "Centro" }]),
    findUnique: vi.fn(async () => ({ id: "t1" })),
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
  },
  // Sedes que coordina quien mira (ticket 73): el alcance es en plural.
  usuarioSede: { findMany: vi.fn(async () => [{ tiendaId: "t2", principal: false }]) },
  user: {
    findMany: vi.fn(async () => [
      { id: "u_ana", nombre: "Ana", apellidos: "García", tiendaId: "t1" },
    ]),
    findUnique: vi.fn(async () => ({ id: "u_ana" })),
  },
  configuracionEmpresa: { findUnique: vi.fn(async () => ({ ventasPreciosActivos: false })) },
  // La transacción se ejecuta con el propio mock: lo que interesa es qué
  // llamadas hace el handler dentro.
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
};

vi.mock("@/lib/prisma", () => ({
  prismaApp: prismaMock,
  prismaMaster: {},
  prismaRuntime: {},
  prismaQuotaWriter: {},
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => sesion),
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

async function get(query = "") {
  const { GET } = await import("./route");
  const { NextRequest } = await import("next/server");
  return GET(new NextRequest(`http://acme.localhost:3000/api/objetivos-venta${query}`));
}

async function put(body: Record<string, unknown>) {
  const { PUT } = await import("./route");
  const { NextRequest } = await import("next/server");
  return PUT(
    new NextRequest("http://acme.localhost:3000/api/objetivos-venta", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  objetivosExistentes.length = 0;
  gruposExistentes.length = 0;
  sesion.user = { id: "u_owner", rol: "OWNER", tiendaId: null, name: "Owner" };
  prismaMock.objetivoVenta.findFirst.mockResolvedValue(null);
  prismaMock.articuloVenta.findUnique.mockResolvedValue({
    id: "art_fibra",
    nombre: "Alta de fibra",
    cuentaParaObjetivos: true,
  });
  prismaMock.articuloVenta.findFirst.mockResolvedValue({ id: "art_fibra" });
  // `clearAllMocks` limpia las llamadas pero no las implementaciones: sin esto,
  // el `null` que pone un test se arrastra a los siguientes.
  prismaMock.user.findUnique.mockResolvedValue({ id: "u_ana" });
  const { _setFeatureCatalogForTest } = await import("@/lib/tenant/features");
  _setFeatureCatalogForTest(["cierre_turno"]);
});

describe("GET /api/objetivos-venta", () => {
  it("un comercial no consulta los objetivos de nadie", async () => {
    sesion.user = { id: "u_ana", rol: "EMPLEADO", tiendaId: "t1", name: "Ana" };
    const res = await get();
    expect(res.status).toBe(403);
  });

  it("el coordinador entra en modo lectura y atado a las sedes que lleva", async () => {
    sesion.user = { id: "u_jefe", rol: "MANAGER", tiendaId: "t1", name: "Jefe" };
    const res = await get("?tiendaId=t9");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { soloLectura: boolean };
    expect(data.soloLectura).toBe(true);
    // Pidió la sede t9, que no lleva: se le sirven las suyas (t1 principal + t2).
    expect(prismaMock.tienda.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["t1", "t2"] } }),
      }),
    );
    // Su equipo son las personas de esas sedes, por sede principal o por
    // asignación N:N.
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { tiendaId: { in: ["t1", "t2"] } },
            { sedes: { some: { tiendaId: { in: ["t1", "t2"] } } } },
          ],
        }),
      }),
    );
  });

  it("el coordinador recibe su propio objetivo de zona (ticket 73)", async () => {
    sesion.user = { id: "u_jefe", rol: "MANAGER", tiendaId: "t1", name: "Jefe" };
    const res = await get();
    const data = (await res.json()) as { objetivoPropio: unknown };
    expect(data.objetivoPropio).not.toBeNull();
  });

  it("administración no tiene objetivo de zona: el suyo es el pie de la tabla", async () => {
    const res = await get();
    const data = (await res.json()) as { objetivoPropio: unknown };
    expect(data.objetivoPropio).toBeNull();
  });

  it("un coordinador SIN sedes asignadas no ve las ventas de todas las tiendas", async () => {
    // El bug que esto cierra: con `tiendaId` null el filtro desaparecía del
    // where y el coordinador terminaba viendo la caja de toda la empresa.
    sesion.user = { id: "u_jefe", rol: "MANAGER", tiendaId: null, name: "Jefe" };
    prismaMock.usuarioSede.findMany.mockResolvedValueOnce([]);
    const res = await get();
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      filasComerciales: unknown[];
      filasSedes: unknown[];
      sinSede: boolean;
    };
    expect(data.sinSede).toBe(true);
    expect(data.filasComerciales).toEqual([]);
    expect(data.filasSedes).toEqual([]);
    // Y no se ha consultado nada de la BD del tenant.
    expect(prismaMock.cierreTurno.findMany).not.toHaveBeenCalled();
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it("administración puede escribir", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { soloLectura: boolean; mes: string };
    expect(data.soloLectura).toBe(false);
    expect(data.mes).toMatch(/^\d{4}-\d{2}$/);
  });

  it("devuelve las dos parrillas, con una casilla por grupo y sin mezclarlas", async () => {
    objetivosExistentes.push({
      id: "obj_ana_hogar",
      mes: "2026-07",
      userId: "u_ana",
      tiendaId: null,
      articuloId: null,
      subcategoria: "Hogar",
      cantidad: 12,
    });
    const res = await get("?mes=2026-07");
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      filasComerciales: { sujetoId: string; celdas: Record<string, { objetivo: number | null }> }[];
      filasSedes: { sujetoId: string; celdas: Record<string, { objetivo: number | null }> }[];
    };
    expect(data.filasComerciales.map((f) => f.sujetoId)).toEqual(["u_ana"]);
    // Una columna de unidades totales ("") y una por grupo de productos. Sin
    // columnas de producto (ticket 528694fa).
    expect(Object.keys(data.filasComerciales[0].celdas).sort()).toEqual(
      ["", COLUMNA_HOGAR].sort(),
    );
    expect(data.filasComerciales[0].celdas[COLUMNA_HOGAR].objetivo).toBe(12);
    // El objetivo personal no aparece en la tabla de sedes: son objetivos distintos.
    expect(data.filasSedes.map((f) => f.sujetoId)).toEqual(["t1"]);
    expect(data.filasSedes[0].celdas[COLUMNA_HOGAR].objetivo).toBeNull();
  });

  it("los grupos de objetivos tienen su propia parrilla y no se mezclan (ticket ff5ab304)", async () => {
    gruposExistentes.push({
      id: "g_tmt",
      nombre: "TMT",
      miembros: [{ userId: "u_ana", tiendaId: null }],
    });
    objetivosExistentes.push({
      id: "obj_tmt",
      mes: "2026-07",
      userId: null,
      tiendaId: null,
      grupoId: "g_tmt",
      articuloId: null,
      cantidad: 200,
    });
    const res = await get("?mes=2026-07");
    const data = (await res.json()) as {
      filasGrupos: { sujetoId: string; sujeto: string; sede: string | null; celdas: Record<string, { objetivo: number | null }> }[];
      filasComerciales: { celdas: Record<string, { objetivo: number | null }> }[];
      totalesGrupos: Record<string, { objetivo: number }>;
      objetivosDelMes: { ambito: string; sujeto: string }[];
    };
    expect(data.filasGrupos.map((f) => f.sujetoId)).toEqual(["g_tmt"]);
    expect(data.filasGrupos[0].celdas[""].objetivo).toBe(200);
    // El subtítulo dice de qué está hecho el grupo.
    expect(data.filasGrupos[0].sede).toBe("1 comercial");
    expect(data.totalesGrupos[""].objetivo).toBe(200);
    // El objetivo del grupo no se cuela en la fila de su miembro.
    expect(data.filasComerciales[0].celdas[""].objetivo).toBeNull();
    expect(data.objetivosDelMes).toEqual([
      expect.objectContaining({ ambito: "grupo", sujeto: "TMT" }),
    ]);
  });

  it("el coordinador no ve un grupo que se sale de sus sedes", async () => {
    sesion.user = { id: "u_jefe", rol: "MANAGER", tiendaId: "t1", name: "Jefe" };
    gruposExistentes.push(
      // "u_ana" sí está entre las personas de sus sedes; "t9" no es suya.
      { id: "g_mio", nombre: "Mi grupo", miembros: [{ userId: "u_ana", tiendaId: null }] },
      { id: "g_ajeno", nombre: "Otra zona", miembros: [{ userId: null, tiendaId: "t9" }] },
    );
    const res = await get();
    const data = (await res.json()) as { filasGrupos: { sujetoId: string }[] };
    expect(data.filasGrupos.map((f) => f.sujetoId)).toEqual(["g_mio"]);
  });

  it("las unidades totales cuadran con lo puesto grupo a grupo", async () => {
    // Lo que reportó el cliente: rellenaba la parrilla y el total (columna, pie
    // de tabla y tarjetas de arriba) se quedaba a cero.
    objetivosExistentes.push({
      id: "obj_ana_hogar",
      mes: "2026-07",
      userId: "u_ana",
      tiendaId: null,
      articuloId: null,
      subcategoria: "Hogar",
      cantidad: 12,
    });
    const res = await get("?mes=2026-07");
    const data = (await res.json()) as {
      filasComerciales: { celdas: Record<string, { objetivo: number | null; derivado?: boolean }> }[];
      totalesComerciales: Record<string, { objetivo: number }>;
      resumen: { objetivo: number; conObjetivo: number };
    };
    expect(data.filasComerciales[0].celdas[""].objetivo).toBe(12);
    expect(data.filasComerciales[0].celdas[""].derivado).toBe(true);
    expect(data.totalesComerciales[""].objetivo).toBe(12);
    expect(data.resumen).toMatchObject({ objetivo: 12, conObjetivo: 1 });
  });

  it("un objetivo de unidades totales fijado a mano manda sobre la suma", async () => {
    objetivosExistentes.push(
      {
        id: "obj_ana_fibra",
        mes: "2026-07",
        userId: "u_ana",
        tiendaId: null,
        articuloId: "art_fibra",
        cantidad: 12,
      },
      {
        id: "obj_ana_total",
        mes: "2026-07",
        userId: "u_ana",
        tiendaId: null,
        articuloId: null,
        cantidad: 30,
      },
    );
    const res = await get("?mes=2026-07");
    const data = (await res.json()) as {
      filasComerciales: { celdas: Record<string, { objetivo: number | null; derivado?: boolean }> }[];
    };
    expect(data.filasComerciales[0].celdas[""].objetivo).toBe(30);
    expect(data.filasComerciales[0].celdas[""].derivado).toBeUndefined();
  });

  it("rechaza un mes con formato inventado", async () => {
    const res = await get("?mes=julio");
    expect(res.status).toBe(400);
  });

  it("hay columna por grupo y el producto excluido no tiene la suya", async () => {
    const res = await get("?mes=2026-07");
    const data = (await res.json()) as {
      articulos: { id: string }[];
      subgrupos: { id: string; etiqueta: string }[];
      excluidos: string[];
      filasComerciales: { celdas: Record<string, unknown> }[];
    };
    // "Accesorios" no sale: su único producto no cuenta para objetivos.
    expect(data.subgrupos).toEqual([
      { id: COLUMNA_HOGAR, subcategoria: "Hogar", etiqueta: "Hogar" },
    ]);
    expect(data.articulos.map((a) => a.id)).toEqual(["art_fibra"]);
    expect(data.excluidos).toEqual(["Funda"]);
    // Sin columna de producto: unidades totales y el grupo.
    expect(Object.keys(data.filasComerciales[0].celdas).sort()).toEqual(
      ["", COLUMNA_HOGAR].sort(),
    );
  });

  it("lo vendido de un producto excluido no suma en el grupo ni en el total", async () => {
    prismaMock.cierreTurno.findMany.mockResolvedValue([
      // `fecha` la lee la consulta de ventas para poder dar el día a día
      // (`ventasPorDia`), aunque a los objetivos del mes les dé igual.
      { id: "c1", userId: "u_ana", tiendaId: "t1", fecha: new Date("2026-07-10T00:00:00Z") },
    ]);
    prismaMock.cierreTurnoVenta.groupBy.mockResolvedValue([
      { cierreId: "c1", articuloId: "art_fibra", _sum: { cantidad: 4 } },
      { cierreId: "c1", articuloId: "art_funda", _sum: { cantidad: 9 } },
    ]);
    const res = await get("?mes=2026-07");
    const data = (await res.json()) as {
      filasComerciales: { celdas: Record<string, { vendido: number }> }[];
    };
    const celdas = data.filasComerciales[0].celdas;
    expect(celdas[""].vendido).toBe(4);
    expect(celdas[COLUMNA_HOGAR].vendido).toBe(4);
    // El producto excluido no tiene columna, pero su venta tampoco se ha
    // colado en la de unidades totales.
    expect(celdas["art_funda"]).toBeUndefined();
  });

  it("el objetivo de un grupo manda sobre el de sus productos en el total derivado", async () => {
    objetivosExistentes.push(
      {
        id: "obj_ana_grupo",
        mes: "2026-07",
        userId: "u_ana",
        tiendaId: null,
        articuloId: null,
        ...HOGAR,
        cantidad: 20,
      },
      {
        id: "obj_ana_fibra",
        mes: "2026-07",
        userId: "u_ana",
        tiendaId: null,
        articuloId: "art_fibra",
        categoria: null,
        cantidad: 12,
      },
    );
    const res = await get("?mes=2026-07");
    const data = (await res.json()) as {
      filasComerciales: { celdas: Record<string, { objetivo: number | null; derivado?: boolean }> }[];
    };
    // 20 del grupo, no 32: la fibra ya está dentro de "Telefonía".
    expect(data.filasComerciales[0].celdas[""].objetivo).toBe(20);
    expect(data.filasComerciales[0].celdas[""].derivado).toBe(true);
    expect(data.filasComerciales[0].celdas[COLUMNA_HOGAR].objetivo).toBe(20);
  });
});

describe("PUT /api/objetivos-venta", () => {
  it("el coordinador no puede fijar objetivos", async () => {
    sesion.user = { id: "u_jefe", rol: "MANAGER", tiendaId: "t1", name: "Jefe" };
    const res = await put({ mes: "2026-07", ambito: "comercial", sujetoId: "u_ana", cantidad: 10 });
    expect(res.status).toBe(403);
  });

  it("crea el objetivo buscándolo primero, no con upsert", async () => {
    const res = await put({ mes: "2026-07", ambito: "comercial", sujetoId: "u_ana", cantidad: 10 });
    expect(res.status).toBe(200);
    expect(prismaMock.objetivoVenta.findFirst).toHaveBeenCalledWith({
      // Los tres destinatarios van explícitos: sin `grupoId: null` la búsqueda
      // casaría también con el objetivo de un grupo del mismo mes.
      where: {
        mes: "2026-07",
        userId: "u_ana",
        tiendaId: null,
        grupoId: null,
        articuloId: null,
        categoria: null,
        subcategoria: null,
      },
      select: { id: true },
    });
    expect(prismaMock.objetivoVenta.create).toHaveBeenCalledWith({
      data: {
        mes: "2026-07",
        userId: "u_ana",
        tiendaId: null,
        grupoId: null,
        articuloId: null,
        categoria: null,
        subcategoria: null,
        cantidad: 10,
      },
      select: { id: true, cantidad: true },
    });
  });

  it("si ya existía, lo actualiza en vez de duplicarlo", async () => {
    prismaMock.objetivoVenta.findFirst.mockResolvedValue({ id: "obj_1" });
    const res = await put({ mes: "2026-07", ambito: "sede", sujetoId: "t1", cantidad: 40 });
    expect(res.status).toBe(200);
    expect(prismaMock.objetivoVenta.create).not.toHaveBeenCalled();
    expect(prismaMock.objetivoVenta.update).toHaveBeenCalledWith({
      where: { id: "obj_1" },
      data: { cantidad: 40 },
      select: { id: true, cantidad: true },
    });
  });

  it("cantidad 0 quita el objetivo", async () => {
    prismaMock.objetivoVenta.findFirst.mockResolvedValue({ id: "obj_1" });
    const res = await put({ mes: "2026-07", ambito: "comercial", sujetoId: "u_ana", cantidad: 0 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ borrado: true });
    expect(prismaMock.objetivoVenta.delete).toHaveBeenCalledWith({ where: { id: "obj_1" } });
  });

  it("un objetivo de alguien que no existe se rechaza", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null as unknown as { id: string });
    const res = await put({ mes: "2026-07", ambito: "comercial", sujetoId: "fantasma", cantidad: 5 });
    expect(res.status).toBe(404);
  });

  it("rechaza cantidades que no son unidades enteras", async () => {
    const res = await put({ mes: "2026-07", ambito: "comercial", sujetoId: "u_ana", cantidad: -3 });
    expect(res.status).toBe(400);
  });

  it("guarda un objetivo de un grupo de objetivos (TMT)", async () => {
    gruposExistentes.push({ id: "g_tmt", nombre: "TMT", miembros: [{ userId: "u_ana", tiendaId: null }] });
    const res = await put({ mes: "2026-07", ambito: "grupo", sujetoId: "g_tmt", cantidad: 200 });
    expect(res.status).toBe(200);
    expect(prismaMock.objetivoVenta.create).toHaveBeenCalledWith({
      data: {
        mes: "2026-07",
        userId: null,
        tiendaId: null,
        grupoId: "g_tmt",
        articuloId: null,
        categoria: null,
        subcategoria: null,
        cantidad: 200,
      },
      select: { id: true, cantidad: true },
    });
  });

  it("un objetivo de un grupo que no existe se rechaza", async () => {
    const res = await put({ mes: "2026-07", ambito: "grupo", sujetoId: "g_fantasma", cantidad: 5 });
    expect(res.status).toBe(404);
    expect(prismaMock.objetivoVenta.create).not.toHaveBeenCalled();
  });

  it("no se fijan objetivos a un grupo desactivado", async () => {
    gruposExistentes.push({ id: "g_viejo", nombre: "Antiguo", activo: false, miembros: [] });
    const res = await put({ mes: "2026-07", ambito: "grupo", sujetoId: "g_viejo", cantidad: 5 });
    expect(res.status).toBe(400);
    expect(prismaMock.objetivoVenta.create).not.toHaveBeenCalled();
  });

  it("guarda un objetivo de un grupo de productos", async () => {
    const res = await put({
      mes: "2026-07",
      ambito: "comercial",
      sujetoId: "u_ana",
      ...HOGAR,
      cantidad: 25,
    });
    expect(res.status).toBe(200);
    // Se guarda sin categoría: dejarla rellena partiría en dos el objetivo de
    // una misma subcategoría (una fila para Empresa y otra para Particular).
    expect(prismaMock.objetivoVenta.create).toHaveBeenCalledWith({
      data: {
        mes: "2026-07",
        userId: "u_ana",
        tiendaId: null,
        grupoId: null,
        articuloId: null,
        subcategoria: "Hogar",
        categoria: null,
        cantidad: 25,
      },
      select: { id: true, cantidad: true },
    });
  });

  it("si llega una categoría junto a la subcategoría, se ignora", async () => {
    // Lo que manda una hoja o un cliente antiguo: el objetivo sigue siendo del
    // grupo entero, no del trozo de una categoría.
    const res = await put({
      mes: "2026-07",
      ambito: "comercial",
      sujetoId: "u_ana",
      subcategoria: "Hogar",
      categoria: "Telefonía",
      cantidad: 25,
    });
    expect(res.status).toBe(200);
    expect(prismaMock.objetivoVenta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subcategoria: "Hogar", categoria: null }),
      }),
    );
  });

  it("un grupo que no está en el catálogo se rechaza", async () => {
    prismaMock.articuloVenta.findFirst.mockResolvedValue(null);
    const res = await put({
      mes: "2026-07",
      ambito: "comercial",
      sujetoId: "u_ana",
      categoria: "Telefonía",
      subcategoria: "Inventado",
      cantidad: 5,
    });
    expect(res.status).toBe(404);
  });

  it("no deja fijar un objetivo sobre la categoría entera (ticket 234c6b0f)", async () => {
    // Las categorías organizan el catálogo y salen en los informes, pero el
    // grupo que puntúa es la subcategoría.
    const res = await put({
      mes: "2026-07",
      ambito: "comercial",
      sujetoId: "u_ana",
      categoria: "Telefonía",
      cantidad: 25,
    });
    expect(res.status).toBe(400);
    expect(prismaMock.objetivoVenta.create).not.toHaveBeenCalled();
  });

  it("no deja mezclar producto y grupo en el mismo objetivo", async () => {
    const res = await put({
      mes: "2026-07",
      ambito: "comercial",
      sujetoId: "u_ana",
      articuloId: "art_fibra",
      ...HOGAR,
      cantidad: 5,
    });
    expect(res.status).toBe(400);
    expect(prismaMock.objetivoVenta.create).not.toHaveBeenCalled();
  });

  it("no deja fijar objetivo a un producto marcado como que no cuenta", async () => {
    prismaMock.articuloVenta.findUnique.mockResolvedValue({
      id: "art_funda",
      nombre: "Funda",
      cuentaParaObjetivos: false,
    });
    const res = await put({
      mes: "2026-07",
      ambito: "comercial",
      sujetoId: "u_ana",
      articuloId: "art_funda",
      cantidad: 5,
    });
    expect(res.status).toBe(400);
    expect(prismaMock.objetivoVenta.create).not.toHaveBeenCalled();
  });
});
