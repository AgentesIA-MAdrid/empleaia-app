import { describe, it, expect } from "vitest";
import {
  agruparProductosPorNombre,
  ambitoDe,
  anotarVentas,
  columnaSubgrupo,
  subgruposDelCatalogo,
  COLUMNA_TOTAL,
  construirConsecucion,
  construirMatriz,
  evaluacionDeArticulo,
  totalesMatriz,
  importeVendido,
  mesAnterior,
  normalizarCantidadObjetivo,
  normalizarMes,
  objetivoDeCoordinacion,
  objetivoTotalDe,
  progresoDe,
  rangoMes,
  vendidoDeSujeto,
  vendidoPara,
  type FilaProductoProgreso,
  type ObjetivoFila,
  type VentaAgregada,
} from "./objetivos";

const objetivo = (o: Partial<ObjetivoFila>): ObjetivoFila => ({
  id: "o1",
  mes: "2026-07",
  userId: null,
  tiendaId: null,
  articuloId: null,
  cantidad: 10,
  ...o,
});

const VENTAS: VentaAgregada[] = [
  { userId: "ana", tiendaId: "t1", articuloId: "fibra", cantidad: 6 },
  { userId: "ana", tiendaId: "t1", articuloId: "movil", cantidad: 4 },
  { userId: "luis", tiendaId: "t1", articuloId: "fibra", cantidad: 3 },
  { userId: "sara", tiendaId: "t2", articuloId: "fibra", cantidad: 5 },
];

/**
 * Catálogo del ticket 714c76dd, con los dos niveles del catálogo: dos productos
 * del grupo "Telefonía → Pospago" y una funda que el cliente ha dejado fuera de
 * los objetivos. El grupo con objetivo es la subcategoría (ticket 234c6b0f).
 */
const CATALOGO = [
  { id: "fibra", categoria: "Telefonía", subcategoria: "Pospago", cuentaParaObjetivos: true },
  { id: "movil", categoria: "Telefonía", subcategoria: "Pospago", cuentaParaObjetivos: true },
  { id: "funda", categoria: "Accesorios", subcategoria: "Fundas", cuentaParaObjetivos: false },
];

const POSPAGO = { categoria: "Telefonía", subcategoria: "Pospago" };
const FUNDAS = { categoria: "Accesorios", subcategoria: "Fundas" };

describe("normalizarMes", () => {
  it("acepta AAAA-MM", () => {
    expect(normalizarMes("2026-07")).toEqual({ ok: true, mes: "2026-07" });
    expect(normalizarMes(" 2026-12 ")).toEqual({ ok: true, mes: "2026-12" });
  });

  it("rechaza lo que no lo es", () => {
    for (const malo of ["2026-13", "2026-00", "26-07", "2026/07", "", null, 202607]) {
      expect(normalizarMes(malo).ok).toBe(false);
    }
  });
});

describe("rangoMes", () => {
  it("va del día 1 al día 1 del mes siguiente", () => {
    const r = rangoMes("2026-07");
    expect(r.desde.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(r.hasta.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("diciembre salta de año", () => {
    const r = rangoMes("2026-12");
    expect(r.hasta.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("mesAnterior", () => {
  it("resta un mes", () => {
    expect(mesAnterior("2026-07")).toBe("2026-06");
  });

  it("enero vuelve a diciembre del año pasado", () => {
    expect(mesAnterior("2026-01")).toBe("2025-12");
  });
});

describe("normalizarCantidadObjetivo", () => {
  it("acepta enteros y cero", () => {
    expect(normalizarCantidadObjetivo(12)).toEqual({ ok: true, cantidad: 12 });
    expect(normalizarCantidadObjetivo("12")).toEqual({ ok: true, cantidad: 12 });
    expect(normalizarCantidadObjetivo(0)).toEqual({ ok: true, cantidad: 0 });
  });

  it("rechaza decimales, negativos y disparates", () => {
    expect(normalizarCantidadObjetivo(1.5).ok).toBe(false);
    expect(normalizarCantidadObjetivo(-1).ok).toBe(false);
    expect(normalizarCantidadObjetivo(9_000_000).ok).toBe(false);
    expect(normalizarCantidadObjetivo("muchas").ok).toBe(false);
  });
});

describe("ambitoDe", () => {
  it("distingue comercial, sede y grupo de objetivos", () => {
    expect(ambitoDe({ userId: "ana" })).toBe("comercial");
    expect(ambitoDe({ tiendaId: "t1" })).toBe("sede");
    expect(ambitoDe({ grupoId: "g_tmt" })).toBe("grupo");
  });

  it("ni dos a la vez ni ninguno", () => {
    expect(ambitoDe({ userId: "ana", tiendaId: "t1" })).toBeNull();
    expect(ambitoDe({ userId: "ana", grupoId: "g_tmt" })).toBeNull();
    expect(ambitoDe({ tiendaId: "t1", grupoId: "g_tmt" })).toBeNull();
    expect(ambitoDe({})).toBeNull();
  });
});

/**
 * Tercer ámbito: los grupos de objetivos del cliente (TMT, televenta…). Lo que
 * se protege aquí es que lo vendido del grupo sea lo de sus miembros y que una
 * venta no se cuente dos veces cuando el grupo lleva una tienda y a su gente.
 */
describe("grupos de objetivos (ticket ff5ab304)", () => {
  const GRUPOS = [
    { id: "g_tmt", nombre: "TMT", userIds: ["ana"], tiendaIds: [] },
    // Lleva la tienda t1 entera y, además, a Ana, que trabaja en ella.
    { id: "g_zona", nombre: "Zona norte", userIds: ["ana"], tiendaIds: ["t1"] },
  ];
  const ventas = anotarVentas(VENTAS, CATALOGO, GRUPOS);

  it("anotarVentas marca en qué grupos cae cada venta, sin repetir", () => {
    expect(ventas.map((v) => [v.userId, v.tiendaId, v.grupoIds])).toEqual([
      ["ana", "t1", ["g_tmt", "g_zona"]],
      ["ana", "t1", ["g_tmt", "g_zona"]],
      ["luis", "t1", ["g_zona"]],
      ["sara", "t2", []],
    ]);
  });

  it("el objetivo del grupo mide lo que venden sus miembros", () => {
    // TMT es solo Ana: 6 + 4.
    expect(vendidoPara(objetivo({ grupoId: "g_tmt" }), ventas)).toBe(10);
    // La zona es la tienda t1 entera (Ana y Luis), contando cada venta una vez
    // aunque Ana esté también por su cuenta: 6 + 4 + 3.
    expect(vendidoPara(objetivo({ grupoId: "g_zona" }), ventas)).toBe(13);
  });

  it("la parrilla de grupos no mezcla los objetivos de los otros ámbitos", () => {
    const objetivos = [
      objetivo({ id: "o_ana", userId: "ana", cantidad: 50 }),
      objetivo({ id: "o_tmt", grupoId: "g_tmt", cantidad: 20 }),
    ];
    const filas = construirMatriz(
      "grupo",
      [{ id: "g_tmt", nombre: "TMT", sede: "1 comercial" }],
      ["fibra", "movil"],
      objetivos,
      ventas,
      CATALOGO.filter((a) => a.cuentaParaObjetivos),
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].celdas[COLUMNA_TOTAL]).toMatchObject({ objetivo: 20, vendido: 10 });
    expect(filas[0].celdas["fibra"]).toMatchObject({ objetivo: null, vendido: 6 });
    // Y el de Ana sigue en su tabla, sin contaminar la del grupo.
    const suyas = construirMatriz(
      "comercial",
      [{ id: "ana", nombre: "Ana" }],
      ["fibra", "movil"],
      objetivos,
      ventas,
      CATALOGO.filter((a) => a.cuentaParaObjetivos),
    );
    expect(suyas[0].celdas[COLUMNA_TOTAL].objetivo).toBe(50);
  });

  it("sin grupos, ninguna venta cae en ninguno (comportamiento de antes)", () => {
    const sinGrupos = anotarVentas(VENTAS, CATALOGO);
    expect(sinGrupos.every((v) => (v.grupoIds ?? []).length === 0)).toBe(true);
    expect(vendidoPara(objetivo({ grupoId: "g_tmt" }), sinGrupos)).toBe(0);
  });

  it("vendidoDeSujeto sirve también para un grupo", () => {
    expect(vendidoDeSujeto(ventas, { ambito: "grupo", id: "g_zona" }, null)).toBe(13);
    expect(vendidoDeSujeto(ventas, { ambito: "grupo", id: "g_zona" }, "fibra")).toBe(9);
  });
});

describe("vendidoPara", () => {
  it("objetivo de comercial y de un artículo", () => {
    expect(vendidoPara(objetivo({ userId: "ana", articuloId: "fibra" }), VENTAS)).toBe(6);
  });

  it("objetivo de comercial sin artículo suma todo el catálogo", () => {
    expect(vendidoPara(objetivo({ userId: "ana" }), VENTAS)).toBe(10);
  });

  it("objetivo de sede suma a todo su equipo", () => {
    expect(vendidoPara(objetivo({ tiendaId: "t1" }), VENTAS)).toBe(13);
  });

  it("objetivo de sede y artículo", () => {
    expect(vendidoPara(objetivo({ tiendaId: "t1", articuloId: "fibra" }), VENTAS)).toBe(9);
  });

  it("las ventas de un artículo ya borrado suman en el total pero no en un artículo", () => {
    const ventas: VentaAgregada[] = [
      { userId: "ana", tiendaId: "t1", articuloId: null, cantidad: 2 },
      { userId: "ana", tiendaId: "t1", articuloId: "fibra", cantidad: 1 },
    ];
    expect(vendidoPara(objetivo({ userId: "ana" }), ventas)).toBe(3);
    expect(vendidoPara(objetivo({ userId: "ana", articuloId: "fibra" }), ventas)).toBe(1);
  });

  it("un comercial sin ventas se queda a cero, no falla", () => {
    expect(vendidoPara(objetivo({ userId: "nadie" }), VENTAS)).toBe(0);
  });
});

describe("grupos de productos y productos que no cuentan (ticket 714c76dd)", () => {
  const ventas = anotarVentas(
    [
      { userId: "ana", tiendaId: "t1", articuloId: "fibra", cantidad: 6 },
      { userId: "ana", tiendaId: "t1", articuloId: "movil", cantidad: 4 },
      { userId: "ana", tiendaId: "t1", articuloId: "funda", cantidad: 9 },
    ],
    CATALOGO,
  );

  it("anotarVentas marca el grupo y si el artículo cuenta", () => {
    expect(
      ventas.map((v) => [v.articuloId, v.categoria, v.subcategoria, v.cuentaParaObjetivos]),
    ).toEqual([
      ["fibra", "Telefonía", "Pospago", true],
      ["movil", "Telefonía", "Pospago", true],
      ["funda", "Accesorios", "Fundas", false],
    ]);
  });

  it("una venta de un artículo que ya no está en el catálogo cuenta igual", () => {
    const [v] = anotarVentas(
      [{ userId: "ana", tiendaId: "t1", articuloId: null, cantidad: 2 }],
      CATALOGO,
    );
    expect(v).toMatchObject({ categoria: null, subcategoria: null, cuentaParaObjetivos: true });
  });

  it("el objetivo de un grupo suma los productos de esa subcategoría", () => {
    expect(vendidoPara(objetivo({ userId: "ana", ...POSPAGO }), ventas)).toBe(10);
    expect(vendidoPara(objetivo({ userId: "ana", ...FUNDAS }), ventas)).toBe(0);
  });

  it("dos subcategorías con el mismo nombre en categorías distintas no se mezclan", () => {
    const catalogo = [
      { id: "a", categoria: "Telefonía", subcategoria: "Renove", cuentaParaObjetivos: true },
      { id: "b", categoria: "Energía", subcategoria: "Renove", cuentaParaObjetivos: true },
    ];
    const suyas = anotarVentas(
      [
        { userId: "ana", tiendaId: "t1", articuloId: "a", cantidad: 4 },
        { userId: "ana", tiendaId: "t1", articuloId: "b", cantidad: 7 },
      ],
      catalogo,
    );
    expect(
      vendidoPara(objetivo({ userId: "ana", categoria: "Telefonía", subcategoria: "Renove" }), suyas),
    ).toBe(4);
    expect(
      vendidoPara(objetivo({ userId: "ana", categoria: "Energía", subcategoria: "Renove" }), suyas),
    ).toBe(7);
  });

  it("lo vendido de un producto excluido no suma en las unidades totales", () => {
    // 6 + 4 de telefonía; las 9 fundas se venden pero no persiguen nada.
    expect(vendidoPara(objetivo({ userId: "ana" }), ventas)).toBe(10);
  });

  it("un objetivo puesto sobre el producto excluido sí mide sus ventas", () => {
    expect(vendidoPara(objetivo({ userId: "ana", articuloId: "funda" }), ventas)).toBe(9);
  });

  it("los grupos del catálogo son las subcategorías con algún producto que cuenta", () => {
    expect(subgruposDelCatalogo(CATALOGO)).toEqual([POSPAGO]);
  });

  it("la parrilla trae columna de grupo y ninguna del producto excluido", () => {
    const filas = construirMatriz(
      "comercial",
      [{ id: "ana", nombre: "Ana" }],
      ["fibra", "movil"],
      [objetivo({ id: "g", userId: "ana", ...POSPAGO, cantidad: 20 })],
      ventas,
      CATALOGO.filter((a) => a.cuentaParaObjetivos),
    );
    expect(Object.keys(filas[0].celdas).sort()).toEqual([
      "",
      "fibra",
      columnaSubgrupo(POSPAGO),
      "movil",
    ].sort());
    expect(filas[0].celdas[columnaSubgrupo(POSPAGO)]).toEqual({
      objetivoId: "g",
      objetivo: 20,
      vendido: 10,
      consecucion: 50,
    });
  });

  it("el total derivado no cuenta dos veces un producto dentro de un grupo con objetivo", () => {
    const suyos = [
      objetivo({ id: "g", userId: "ana", ...POSPAGO, cantidad: 20 }),
      objetivo({ id: "f", userId: "ana", articuloId: "fibra", cantidad: 12 }),
      objetivo({ id: "x", userId: "ana", articuloId: "otro", cantidad: 3 }),
    ];
    const r = objetivoTotalDe(suyos, ["fibra", "movil", "otro"], [
      ...CATALOGO,
      { id: "otro", categoria: null, subcategoria: null, cuentaParaObjetivos: true },
    ]);
    // 20 del grupo + 3 del producto suelto; la fibra ya va dentro del grupo.
    expect(r).toEqual({ cantidad: 23, derivado: true });
  });

  it("un objetivo de un grupo que ya no existe no suma en el total", () => {
    const r = objetivoTotalDe(
      [
        objetivo({
          id: "g",
          userId: "ana",
          categoria: "Telefonía",
          subcategoria: "Ya no existe",
          cantidad: 20,
        }),
      ],
      ["fibra"],
      CATALOGO,
    );
    expect(r).toEqual({ cantidad: null, derivado: false });
  });

  it("el progreso del comercial mide el objetivo de grupo sin las ventas excluidas", () => {
    const r = progresoDe(
      [objetivo({ id: "g", userId: "ana", ...POSPAGO, cantidad: 20 })],
      ventas,
      { ambito: "comercial", id: "ana" },
      ["fibra", "movil"],
      CATALOGO.filter((a) => a.cuentaParaObjetivos),
    );
    expect(r).toEqual({ vendido: 10, objetivo: 20, consecucion: 50 });
  });

  it("el pie de la tabla suma también las columnas de grupo", () => {
    const filas = construirMatriz(
      "comercial",
      [{ id: "ana", nombre: "Ana" }],
      ["fibra", "movil"],
      [objetivo({ id: "g", userId: "ana", ...POSPAGO, cantidad: 20 })],
      ventas,
      CATALOGO.filter((a) => a.cuentaParaObjetivos),
    );
    const totales = totalesMatriz(filas, ["fibra", "movil"], [POSPAGO]);
    expect(totales[columnaSubgrupo(POSPAGO)]).toEqual({
      objetivo: 20,
      vendido: 10,
      consecucion: 50,
      conObjetivo: 1,
    });
  });
});

describe("construirConsecucion", () => {
  it("calcula el porcentaje por objetivo", () => {
    const filas = construirConsecucion(
      [
        objetivo({ id: "a", userId: "ana", cantidad: 20 }),
        objetivo({ id: "b", tiendaId: "t1", articuloId: "fibra", cantidad: 9 }),
      ],
      VENTAS,
    );
    expect(filas).toEqual([
      {
        objetivoId: "a",
        ambito: "comercial",
        sujetoId: "ana",
        articuloId: null,
        objetivo: 20,
        vendido: 10,
        consecucion: 50,
      },
      {
        objetivoId: "b",
        ambito: "sede",
        sujetoId: "t1",
        articuloId: "fibra",
        objetivo: 9,
        vendido: 9,
        consecucion: 100,
      },
    ]);
  });

  it("un objetivo a cero no da 100 % ni divide por cero", () => {
    const [fila] = construirConsecucion([objetivo({ userId: "ana", cantidad: 0 })], VENTAS);
    expect(fila?.consecucion).toBeNull();
  });

  it("descarta objetivos corruptos en vez de pintarlos mal", () => {
    const filas = construirConsecucion(
      [objetivo({ id: "malo", userId: "ana", tiendaId: "t1" }), objetivo({ id: "ok", userId: "ana" })],
      VENTAS,
    );
    expect(filas.map((f) => f.objetivoId)).toEqual(["ok"]);
  });

  it("redondea a un decimal", () => {
    const [fila] = construirConsecucion([objetivo({ userId: "ana", cantidad: 3 })], VENTAS);
    expect(fila?.consecucion).toBe(333.3);
  });
});

describe("vendidoDeSujeto", () => {
  it("sirve para las casillas todavía sin objetivo", () => {
    expect(vendidoDeSujeto(VENTAS, { ambito: "comercial", id: "luis" }, "fibra")).toBe(3);
    expect(vendidoDeSujeto(VENTAS, { ambito: "sede", id: "t2" }, null)).toBe(5);
  });
});

describe("importeVendido", () => {
  it("multiplica por el precio de cada artículo", () => {
    const precios = new Map<string, number | null>([
      ["fibra", 30],
      ["movil", 10.5],
    ]);
    expect(importeVendido(VENTAS, precios)).toEqual({ importe: 462, unidadesSinPrecio: 0 });
  });

  it("cuenta aparte las unidades de artículos sin precio", () => {
    const precios = new Map<string, number | null>([
      ["fibra", 30],
      ["movil", null],
    ]);
    const r = importeVendido(VENTAS, precios);
    expect(r.importe).toBe(420);
    expect(r.unidadesSinPrecio).toBe(4);
  });

  it("las ventas de artículos borrados no inventan importe", () => {
    const r = importeVendido([{ userId: "ana", tiendaId: "t1", articuloId: null, cantidad: 7 }], new Map());
    expect(r).toEqual({ importe: 0, unidadesSinPrecio: 7 });
  });

  it("redondea a céntimos", () => {
    const r = importeVendido(
      [{ userId: "ana", tiendaId: "t1", articuloId: "x", cantidad: 3 }],
      new Map([["x", 0.335]]),
    );
    expect(r.importe).toBe(1.01);
  });
});

describe("progresoDe", () => {
  const objetivos = [
    objetivo({ id: "total-ana", userId: "ana", cantidad: 20 }),
    objetivo({ id: "fibra-ana", userId: "ana", articuloId: "fibra", cantidad: 5 }),
    objetivo({ id: "sede", tiendaId: "t1", cantidad: 26 }),
  ];

  it("usa solo el objetivo de unidades totales", () => {
    expect(progresoDe(objetivos, VENTAS, { ambito: "comercial", id: "ana" })).toEqual({
      vendido: 10,
      objetivo: 20,
      consecucion: 50,
    });
  });

  it("el de la sede mide toda la sede", () => {
    expect(progresoDe(objetivos, VENTAS, { ambito: "sede", id: "t1" })).toEqual({
      vendido: 13,
      objetivo: 26,
      consecucion: 50,
    });
  });

  it("sin objetivo fijado no inventa un cero", () => {
    expect(progresoDe(objetivos, VENTAS, { ambito: "comercial", id: "luis" })).toEqual({
      vendido: 3,
      objetivo: null,
      consecucion: null,
    });
  });

  it("si solo hay objetivos por producto, el total es su suma", () => {
    const soloProductos = [
      objetivo({ id: "fibra-luis", userId: "luis", articuloId: "fibra", cantidad: 4 }),
      objetivo({ id: "movil-luis", userId: "luis", articuloId: "movil", cantidad: 2 }),
    ];
    expect(progresoDe(soloProductos, VENTAS, { ambito: "comercial", id: "luis" })).toEqual({
      vendido: 3,
      objetivo: 6,
      consecucion: 50,
    });
  });
});

describe("agruparProductosPorNombre — mismo nombre, distinta categoría (ticket 7dd7ac00)", () => {
  const fila = (f: Partial<FilaProductoProgreso>): FilaProductoProgreso => ({
    articuloId: "a1",
    nombre: "Fibra 1 GB",
    vendido: 0,
    objetivo: null,
    consecucion: null,
    importe: null,
    cuentaParaObjetivos: true,
    productos: 1,
    ...f,
  });

  it("suma las unidades de los productos que se llaman igual", () => {
    const filas = agruparProductosPorNombre([
      fila({ articuloId: "fibra-particular", vendido: 1 }),
      fila({ articuloId: "fibra-empresa", vendido: 2 }),
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      articuloId: "fibra-particular",
      nombre: "Fibra 1 GB",
      vendido: 3,
      productos: 2,
    });
  });

  it("suma los objetivos y recalcula la consecución sobre el total", () => {
    const [f] = agruparProductosPorNombre([
      fila({ articuloId: "p", vendido: 1, objetivo: 2, consecucion: 50 }),
      fila({ articuloId: "e", vendido: 2, objetivo: 2, consecucion: 100 }),
    ]);
    expect(f).toMatchObject({ vendido: 3, objetivo: 4, consecucion: 75 });
  });

  it("sin ningún objetivo no inventa un cero", () => {
    const [f] = agruparProductosPorNombre([
      fila({ articuloId: "p", vendido: 1 }),
      fila({ articuloId: "e", vendido: 2 }),
    ]);
    expect(f).toMatchObject({ objetivo: null, consecucion: null });
  });

  it("el objetivo de uno solo mide las unidades de los dos", () => {
    const [f] = agruparProductosPorNombre([
      fila({ articuloId: "p", vendido: 1, objetivo: 3, consecucion: 33.3 }),
      fila({ articuloId: "e", vendido: 2 }),
    ]);
    expect(f).toMatchObject({ vendido: 3, objetivo: 3, consecucion: 100 });
  });

  it("compara el nombre sin tildes, mayúsculas ni espacios de más", () => {
    const filas = agruparProductosPorNombre([
      fila({ articuloId: "p", nombre: "Energía  Luz", vendido: 1 }),
      fila({ articuloId: "e", nombre: "energia luz", vendido: 2 }),
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ nombre: "Energía  Luz", vendido: 3 });
  });

  it("no mezcla productos distintos y respeta el orden del catálogo", () => {
    const filas = agruparProductosPorNombre([
      fila({ articuloId: "fibra-p", nombre: "Fibra", vendido: 1 }),
      fila({ articuloId: "movil", nombre: "Móvil", vendido: 4 }),
      fila({ articuloId: "fibra-e", nombre: "Fibra", vendido: 2 }),
    ]);
    expect(filas.map((f) => [f.nombre, f.vendido])).toEqual([
      ["Fibra", 3],
      ["Móvil", 4],
    ]);
  });

  it("suma el importe que se puede calcular y deja null si no hay ninguno", () => {
    const [conPrecio] = agruparProductosPorNombre([
      fila({ articuloId: "p", vendido: 1, importe: 10.5 }),
      fila({ articuloId: "e", vendido: 2, importe: null }),
    ]);
    expect(conPrecio.importe).toBe(10.5);
    const [sinPrecio] = agruparProductosPorNombre([
      fila({ articuloId: "p", vendido: 1 }),
      fila({ articuloId: "e", vendido: 2 }),
    ]);
    expect(sinPrecio.importe).toBeNull();
  });

  it("la fila cuenta para los objetivos si lo hace alguno de sus productos", () => {
    const [mixto] = agruparProductosPorNombre([
      fila({ articuloId: "p", vendido: 1, cuentaParaObjetivos: false }),
      fila({ articuloId: "e", vendido: 2, cuentaParaObjetivos: true }),
    ]);
    expect(mixto.cuentaParaObjetivos).toBe(true);
    const [excluido] = agruparProductosPorNombre([
      fila({ articuloId: "p", vendido: 1, cuentaParaObjetivos: false }),
      fila({ articuloId: "e", vendido: 2, cuentaParaObjetivos: false }),
    ]);
    expect(excluido.cuentaParaObjetivos).toBe(false);
  });
});

describe("construirMatriz", () => {
  const objetivos = [
    objetivo({ id: "total-ana", userId: "ana", cantidad: 20 }),
    objetivo({ id: "fibra-ana", userId: "ana", articuloId: "fibra", cantidad: 5 }),
    objetivo({ id: "fibra-t1", tiendaId: "t1", articuloId: "fibra", cantidad: 8 }),
  ];
  const comerciales = [
    { id: "ana", nombre: "Ana García", sede: "Centro" },
    { id: "luis", nombre: "Luis Pérez", sede: "Centro" },
  ];

  it("da una casilla por comercial y artículo, más la de unidades totales", () => {
    const filas = construirMatriz("comercial", comerciales, ["fibra", "movil"], objetivos, VENTAS);
    expect(filas.map((f) => f.sujetoId)).toEqual(["ana", "luis"]);
    expect(Object.keys(filas[0].celdas).sort()).toEqual(["", "fibra", "movil"]);
    expect(filas[0].celdas[""]).toEqual({
      objetivoId: "total-ana",
      objetivo: 20,
      vendido: 10,
      consecucion: 50,
    });
    expect(filas[0].celdas["fibra"]).toEqual({
      objetivoId: "fibra-ana",
      objetivo: 5,
      vendido: 6,
      consecucion: 120,
    });
    // Sin objetivo fijado la casilla va vacía, pero lo vendido se sigue viendo.
    expect(filas[1].celdas["fibra"]).toEqual({
      objetivoId: null,
      objetivo: null,
      vendido: 3,
      consecucion: null,
    });
    expect(filas[0].sede).toBe("Centro");
  });

  it("los objetivos personales no se cuelan en la parrilla de sedes", () => {
    const filas = construirMatriz(
      "sede",
      [{ id: "t1", nombre: "Centro" }],
      ["fibra", "movil"],
      objetivos,
      VENTAS,
    );
    // La sede vende lo de todo su equipo, y solo tiene su propio objetivo.
    expect(filas[0].celdas["fibra"]).toEqual({
      objetivoId: "fibra-t1",
      objetivo: 8,
      vendido: 9,
      consecucion: 112.5,
    });
    // Sin objetivo de unidades totales fijado a mano, el total es la suma de
    // los productos de esa fila (aquí, solo fibra).
    expect(filas[0].celdas[""].objetivo).toBe(8);
    expect(filas[0].celdas[""].derivado).toBe(true);
    expect(filas[0].celdas[""].vendido).toBe(13);
    expect(filas[0].sede).toBeNull();
  });

  it("una venta de artículo borrado suma en unidades totales y en ninguna columna de producto", () => {
    const ventas: VentaAgregada[] = [
      { userId: "ana", tiendaId: "t1", articuloId: null, cantidad: 4 },
    ];
    const filas = construirMatriz("comercial", comerciales, ["fibra"], [], ventas);
    expect(filas[0].celdas[""].vendido).toBe(4);
    expect(filas[0].celdas["fibra"].vendido).toBe(0);
  });
});

describe("totalesMatriz", () => {
  it("suma cada columna y cuenta quién tiene objetivo", () => {
    const filas = construirMatriz(
      "comercial",
      [
        { id: "ana", nombre: "Ana" },
        { id: "luis", nombre: "Luis" },
      ],
      ["fibra"],
      [
        objetivo({ id: "fibra-ana", userId: "ana", articuloId: "fibra", cantidad: 5 }),
        objetivo({ id: "fibra-luis", userId: "luis", articuloId: "fibra", cantidad: 5 }),
      ],
      VENTAS,
    );
    expect(totalesMatriz(filas, ["fibra"])["fibra"]).toEqual({
      objetivo: 10,
      vendido: 9,
      consecucion: 90,
      conObjetivo: 2,
    });
    // Y el total de unidades cuadra con lo puesto producto a producto: nadie
    // fijó un total a mano, así que sale de sumar las columnas.
    expect(totalesMatriz(filas, ["fibra"])[""]).toEqual({
      objetivo: 10,
      vendido: 13,
      consecucion: 130,
      conObjetivo: 2,
    });
  });

  it("sin ningún objetivo en la parrilla no hay consecución que enseñar", () => {
    const filas = construirMatriz(
      "comercial",
      [{ id: "ana", nombre: "Ana" }],
      ["fibra"],
      [],
      VENTAS,
    );
    expect(totalesMatriz(filas, ["fibra"])[""]).toEqual({
      objetivo: 0,
      vendido: 10,
      consecucion: null,
      conObjetivo: 0,
    });
  });
});

describe("objetivoTotalDe", () => {
  it("manda el objetivo de unidades totales fijado a mano", () => {
    const r = objetivoTotalDe([
      objetivo({ id: "total", userId: "ana", cantidad: 30 }),
      objetivo({ id: "fibra", userId: "ana", articuloId: "fibra", cantidad: 5 }),
    ]);
    expect(r).toEqual({ cantidad: 30, derivado: false });
  });

  it("si no lo hay, suma lo puesto producto a producto", () => {
    const r = objetivoTotalDe([
      objetivo({ id: "fibra", userId: "ana", articuloId: "fibra", cantidad: 5 }),
      objetivo({ id: "movil", userId: "ana", articuloId: "movil", cantidad: 7 }),
    ]);
    expect(r).toEqual({ cantidad: 12, derivado: true });
  });

  it("solo suman los productos del catálogo, que son las columnas que se ven", () => {
    const r = objetivoTotalDe(
      [
        objetivo({ id: "fibra", userId: "ana", articuloId: "fibra", cantidad: 5 }),
        objetivo({ id: "viejo", userId: "ana", articuloId: "retirado", cantidad: 7 }),
      ],
      ["fibra"],
    );
    expect(r).toEqual({ cantidad: 5, derivado: true });
  });

  it("sin ningún objetivo no inventa un cero", () => {
    expect(objetivoTotalDe([])).toEqual({ cantidad: null, derivado: false });
  });
});

describe("objetivoDeCoordinacion — el objetivo de zona (ticket 73)", () => {
  const celda = (objetivo: number | null, vendido: number, consecucion: number | null) => ({
    [COLUMNA_TOTAL]: { objetivoId: objetivo === null ? null : "o1", objetivo, vendido, consecucion },
  });

  it("suma el objetivo y lo vendido de sus sedes", () => {
    const r = objetivoDeCoordinacion({
      filasSedes: [
        { sujetoId: "t1", sujeto: "Centro", sede: null, celdas: celda(100, 120, 120) },
        { sujetoId: "t2", sujeto: "Norte", sede: null, celdas: celda(100, 60, 60) },
      ],
      filasComerciales: [],
    });
    expect(r.objetivo).toBe(200);
    expect(r.vendido).toBe(180);
    expect(r.consecucion).toBe(90);
  });

  it("cuenta cuántas sedes y cuántas personas llegan al 100 %", () => {
    const r = objetivoDeCoordinacion({
      filasSedes: [
        { sujetoId: "t1", sujeto: "Centro", sede: null, celdas: celda(100, 120, 120) },
        { sujetoId: "t2", sujeto: "Norte", sede: null, celdas: celda(100, 60, 60) },
        { sujetoId: "t3", sujeto: "Sur", sede: null, celdas: celda(100, 100, 100) },
      ],
      filasComerciales: [
        { sujetoId: "u1", sujeto: "Ana", sede: "Centro", celdas: celda(20, 25, 125) },
        { sujetoId: "u2", sujeto: "Luis", sede: "Norte", celdas: celda(20, 10, 50) },
      ],
    });
    expect(r.sedesCumplen).toBe(2);
    expect(r.sedesConObjetivo).toBe(3);
    expect(r.comercialesCumplen).toBe(1);
    expect(r.comercialesConObjetivo).toBe(2);
  });

  it("una sede sin objetivo no cuenta como incumplida", () => {
    const r = objetivoDeCoordinacion({
      filasSedes: [
        { sujetoId: "t1", sujeto: "Centro", sede: null, celdas: celda(100, 100, 100) },
        { sujetoId: "t2", sujeto: "Sin cifra", sede: null, celdas: celda(null, 40, null) },
      ],
      filasComerciales: [],
    });
    expect(r.sedesConObjetivo).toBe(1);
    expect(r.sedesCumplen).toBe(1);
    // Pero lo vendido de esa sede sí suma: se ha vendido de verdad.
    expect(r.vendido).toBe(140);
  });

  it("sin objetivo en ninguna sede no hay consecución que enseñar", () => {
    const r = objetivoDeCoordinacion({
      filasSedes: [{ sujetoId: "t1", sujeto: "Centro", sede: null, celdas: celda(null, 10, null) }],
      filasComerciales: [],
    });
    expect(r.objetivo).toBe(0);
    expect(r.consecucion).toBeNull();
  });
});

describe("evaluacionDeArticulo — el distintivo del catálogo (ticket cd804fa2)", () => {
  const objetivos = (articuloIds: string[], grupos: { categoria: string | null; subcategoria: string }[]) => ({
    articuloIds: new Set(articuloIds),
    subgrupos: new Set(grupos.map((g) => columnaSubgrupo(g))),
  });

  it("con objetivo puesto sobre él, el producto se mide solo", () => {
    const r = evaluacionDeArticulo({ id: "fibra", ...POSPAGO }, objetivos(["fibra"], []));
    expect(r.modo).toBe("producto");
  });

  it("sin objetivo propio pero con el de su grupo, lo mide su subcategoría", () => {
    const r = evaluacionDeArticulo({ id: "fibra", ...POSPAGO }, objetivos([], [POSPAGO]));
    expect(r).toEqual({ modo: "grupo", grupo: POSPAGO });
  });

  it("sin objetivo ni suyo ni de su grupo, solo suma en unidades totales", () => {
    const r = evaluacionDeArticulo({ id: "fibra", ...POSPAGO }, objetivos(["movil"], [FUNDAS]));
    expect(r.modo).toBe("total");
  });

  it("el objetivo de otra subcategoría con el mismo nombre no lo mide", () => {
    const r = evaluacionDeArticulo(
      { id: "renove", categoria: "Telefonía", subcategoria: "Renove" },
      objetivos([], [{ categoria: "Energía", subcategoria: "Renove" }]),
    );
    expect(r.modo).toBe("total");
  });

  it("marcado como que no cuenta, no lo evalúa nada", () => {
    const r = evaluacionDeArticulo(
      { id: "funda", ...FUNDAS, cuentaParaObjetivos: false },
      objetivos([], [FUNDAS]),
    );
    expect(r.modo).toBe("excluido");
  });

  it("un objetivo puesto sobre él manda sobre el interruptor: si alguien lo fijó, se persigue", () => {
    // Misma regla que `vendidoPara`: un objetivo sobre el artículo concreto sí
    // mide sus ventas aunque no cuente para el total ni para su grupo.
    const r = evaluacionDeArticulo(
      { id: "funda", ...FUNDAS, cuentaParaObjetivos: false },
      objetivos(["funda"], []),
    );
    expect(r.modo).toBe("producto");
  });

  it("sin subcategoría no hay grupo que lo mida", () => {
    const r = evaluacionDeArticulo(
      { id: "suelto", categoria: "Telefonía", subcategoria: null },
      objetivos([], [POSPAGO]),
    );
    expect(r.modo).toBe("total");
  });
});
