/**
 * Plantilla de objetivos de venta: qué baja en la hoja y qué se entiende de la
 * que vuelve. Lo que se protege aquí:
 *
 *  1. La hoja lleva las mismas columnas que la parrilla (totales, grupos y
 *     productos) y no ofrece casilla a los artículos que no cuentan.
 *  2. Solo baja escrito lo fijado a mano: el total derivado se queda en blanco.
 *  3. Una casilla vacía no borra nada; el 0 sí quita el objetivo.
 *  4. Lo que no se entiende (nombre desconocido, columna rara, decimales) se
 *     cuenta como ignorado en vez de tumbar la importación entera.
 *  5. El viaje completo por un .xlsx de verdad: generar → leer → interpretar.
 */

import { describe, it, expect } from "vitest";
import { leerHojaExcel } from "./catalogo-excel";
import { generarPlantillaObjetivos } from "./objetivos-excel";
import {
  columnasPlantilla,
  filasPlantilla,
  interpretarPlantillaObjetivos,
  leerMesPlantilla,
  parsearCantidadPlantilla,
  type ArticuloPlantilla,
} from "./objetivos-plantilla";
import { columnaSubgrupo, type ObjetivoFila } from "./objetivos";

const catalogo: ArticuloPlantilla[] = [
  {
    id: "art_fibra",
    nombre: "Alta de fibra",
    categoria: "Telefonía",
    subcategoria: "Hogar",
    cuentaParaObjetivos: true,
  },
  {
    id: "art_movil",
    nombre: "Portabilidad",
    categoria: "Telefonía",
    subcategoria: "Hogar",
    cuentaParaObjetivos: true,
  },
  {
    id: "art_funda",
    nombre: "Funda",
    categoria: "Accesorios",
    subcategoria: "Fundas",
    cuentaParaObjetivos: false,
  },
];

/** El grupo con objetivo es la subcategoría (ticket 234c6b0f). */
const HOGAR = { subcategoria: "Hogar" };
const FUNDAS = { categoria: "Accesorios", subcategoria: "Fundas" };

const ctx = {
  comerciales: [{ id: "u_ana", nombre: "Ana García" }],
  sedes: [{ id: "t1", nombre: "Centro" }],
  articulos: catalogo,
};

const sujetos = [
  { ambito: "comercial" as const, id: "u_ana", nombre: "Ana García" },
  { ambito: "sede" as const, id: "t1", nombre: "Centro" },
];

const objetivo = (o: Partial<ObjetivoFila>): ObjetivoFila => ({
  id: "o1",
  mes: "2026-07",
  userId: null,
  tiendaId: null,
  articuloId: null,
  categoria: null,
  cantidad: 0,
  ...o,
});

describe("columnasPlantilla", () => {
  it("lleva unidades totales y un grupo por subcategoría, sin columnas de producto", () => {
    // Ticket 528694fa: los objetivos se fijan por grupo. La hoja es la parrilla
    // en Excel, así que tampoco lleva columna por producto.
    expect(columnasPlantilla(catalogo).map((c) => c.titulo)).toEqual([
      "Unidades totales",
      "Grupo: Hogar",
    ]);
  });

  it("un artículo que no cuenta para objetivos no tiene columna", () => {
    const ids = columnasPlantilla(catalogo).map((c) => c.id);
    expect(ids).not.toContain("art_funda");
    // Y su grupo tampoco: no queda ningún producto que lo empuje.
    expect(ids).not.toContain(columnaSubgrupo(FUNDAS));
  });

  it("solo hay una columna por subcategoría, aunque tenga varios productos", () => {
    const columnas = columnasPlantilla([
      {
        id: "art_1",
        nombre: "Fibra 1 GB",
        categoria: "Particular",
        subcategoria: "FFTH",
        cuentaParaObjetivos: true,
      },
      {
        id: "art_2",
        nombre: "Fibra General",
        categoria: "Empresa",
        subcategoria: "FFTH",
        cuentaParaObjetivos: true,
      },
    ]);
    expect(columnas.map((c) => c.titulo)).toEqual(["Unidades totales", "Grupo: FFTH"]);
  });
});

describe("filasPlantilla", () => {
  it("rellena cada casilla con el objetivo fijado de ese sujeto y esa columna", () => {
    const columnas = columnasPlantilla(catalogo);
    const filas = filasPlantilla(sujetos, columnas, [
      objetivo({ id: "o2", userId: "u_ana", ...HOGAR, cantidad: 20 }),
      objetivo({ id: "o3", tiendaId: "t1", cantidad: 90 }),
    ]);

    // [Ámbito, nombre, id, unidades totales, grupo Hogar]
    expect(filas[0]).toEqual(["Comercial", "Ana García", "u_ana", "", 20]);
    expect(filas[1]).toEqual(["Sede", "Centro", "t1", 90, ""]);
  });

  it("no mezcla los objetivos de la sede con los del comercial", () => {
    const columnas = columnasPlantilla(catalogo);
    const filas = filasPlantilla(sujetos, columnas, [
      objetivo({ id: "o1", tiendaId: "t1", ...HOGAR, cantidad: 50 }),
    ]);
    expect(filas[0][4]).toBe(""); // el comercial sigue sin objetivo del grupo
    expect(filas[1][4]).toBe(50);
  });
});

describe("parsearCantidadPlantilla", () => {
  it("acepta lo que sale de Excel y lo que escribe una persona", () => {
    expect(parsearCantidadPlantilla("30")).toEqual({ ok: true, cantidad: 30 });
    expect(parsearCantidadPlantilla(" 30 uds ")).toEqual({ ok: true, cantidad: 30 });
    expect(parsearCantidadPlantilla("1.200")).toEqual({ ok: true, cantidad: 1200 });
    expect(parsearCantidadPlantilla("30,0")).toEqual({ ok: true, cantidad: 30 });
  });

  it("no recorta un decimal en silencio ni admite negativos", () => {
    expect(parsearCantidadPlantilla("12,5").ok).toBe(false);
    expect(parsearCantidadPlantilla("-3").ok).toBe(false);
    expect(parsearCantidadPlantilla("cuarenta").ok).toBe(false);
  });
});

describe("interpretarPlantillaObjetivos", () => {
  // La hoja de hoy: unidades totales y un grupo por subcategoría. La columna
  // "Alta de fibra" es de una hoja antigua y ahora se ignora (ticket 528694fa).
  const cabecera = ["Ámbito", "Comercial o punto de venta", "Id", "Unidades totales", "Grupo: Hogar"];

  it("lee la hoja tal cual baja y devuelve los objetivos a fijar", () => {
    const r = interpretarPlantillaObjetivos(
      [["Mes", "2026-07"], cabecera, ["Comercial", "Ana García", "u_ana", "40", "20"]],
      ctx,
    );
    expect(r.cabeceraEncontrada).toBe(true);
    expect(r.mes).toBe("2026-07");
    expect(r.cambios).toEqual([
      expect.objectContaining({ ambito: "comercial", sujetoId: "u_ana", articuloId: null, categoria: null, cantidad: 40 }),
      expect.objectContaining({ ...HOGAR, articuloId: null, cantidad: 20 }),
    ]);
  });

  it("una casilla vacía no toca nada y el 0 quita el objetivo", () => {
    const r = interpretarPlantillaObjetivos(
      [cabecera, ["Comercial", "Ana García", "u_ana", "", "0"]],
      ctx,
    );
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]).toMatchObject({ ...HOGAR, cantidad: 0 });
  });

  it("una columna de producto de una hoja antigua se ignora y dice dónde va la cifra", () => {
    const r = interpretarPlantillaObjetivos(
      [
        ["Ámbito", "Comercial o punto de venta", "Id", "Alta de fibra"],
        ["Comercial", "Ana García", "u_ana", "12"],
      ],
      ctx,
    );
    expect(r.cambios).toHaveLength(0);
    expect(r.columnasIgnoradas).toEqual([
      { columna: "Alta de fibra", motivo: 'Los objetivos se fijan por grupo: pon la cifra en la columna "Grupo: Hogar".' },
    ]);
  });

  it("el id manda sobre el nombre y sobre el ámbito escrito", () => {
    const r = interpretarPlantillaObjetivos(
      [cabecera, ["Comercial", "Nombre viejo", "t1", "90", ""]],
      ctx,
    );
    expect(r.cambios[0]).toMatchObject({ ambito: "sede", sujetoId: "t1", cantidad: 90 });
  });

  it("sin id se busca por nombre, sin distinguir tildes ni mayúsculas", () => {
    const r = interpretarPlantillaObjetivos(
      [
        ["Ámbito", "Comercial o punto de venta", "Unidades totales"],
        ["comercial", "ana garcia", "25"],
      ],
      ctx,
    );
    expect(r.cambios[0]).toMatchObject({ ambito: "comercial", sujetoId: "u_ana", cantidad: 25 });
  });

  it("una fila de alguien que ya no está se ignora, y las demás se importan", () => {
    const r = interpretarPlantillaObjetivos(
      [
        cabecera,
        ["Comercial", "Quien sea", "", "10", ""],
        ["Comercial", "Ana García", "u_ana", "40", ""],
      ],
      ctx,
    );
    expect(r.cambios).toHaveLength(1);
    expect(r.ignoradas[0].motivo).toContain("Quien sea");
  });

  it("una columna que no casa con el catálogo se deja fuera y se dice", () => {
    const r = interpretarPlantillaObjetivos(
      [
        ["Ámbito", "Comercial o punto de venta", "Id", "Seguros", "Funda"],
        ["Comercial", "Ana García", "u_ana", "5", "3"],
      ],
      ctx,
    );
    expect(r.cambios).toHaveLength(0);
    expect(r.columnasIgnoradas.map((c) => c.columna)).toEqual(["Seguros", "Funda"]);
    // La funda existe, pero el cliente la ha dejado fuera de los objetivos.
    expect(r.columnasIgnoradas[1].motivo).toContain("no cuenta");
  });

  it("una columna de producto ya no casa: los objetivos van por grupo", () => {
    const r = interpretarPlantillaObjetivos(
      [
        ["Ámbito", "Comercial o punto de venta", "Id", "Portabilidad"],
        ["Comercial", "Ana García", "u_ana", "4"],
      ],
      ctx,
    );
    expect(r.cambios).toHaveLength(0);
    expect(r.columnasIgnoradas[0].motivo).toContain("por grupo");
  });

  it("las columnas de artículo se ignoran, se llamen como se llamen", () => {
    const conRepetidos = {
      ...ctx,
      articulos: [
        { id: "art_tel", nombre: "Renove", categoria: "Telefonía", cuentaParaObjetivos: true },
        { id: "art_ene", nombre: "Renove", categoria: "Energía", cuentaParaObjetivos: true },
      ],
    };
    const r = interpretarPlantillaObjetivos(
      [
        ["Ámbito", "Comercial o punto de venta", "Id", "Renove (Energía)", "Renove"],
        ["Comercial", "Ana García", "u_ana", "7", "3"],
      ],
      conRepetidos,
    );
    // Ninguna cifra entra: los objetivos se fijan por grupo (ticket 528694fa).
    expect(r.cambios).toHaveLength(0);
    expect(r.columnasIgnoradas.map((c) => c.columna)).toEqual(["Renove (Energía)", "Renove"]);
  });

  it("la misma subcategoría en dos categorías es un solo grupo, y se casa por su nombre", () => {
    // Ticket 528694fa: ya no hay grupos homónimos que desambiguar. Y una hoja
    // descargada antes del cambio trae "Categoría → Subcategoría" en la
    // cabecera: se sigue aceptando, vale lo que va tras la flecha.
    const dosCategorias = {
      ...ctx,
      articulos: [
        {
          id: "art_tel",
          nombre: "Renove móvil",
          categoria: "Telefonía",
          subcategoria: "Renove",
          cuentaParaObjetivos: true,
        },
        {
          id: "art_ene",
          nombre: "Renove luz",
          categoria: "Energía",
          subcategoria: "Renove",
          cuentaParaObjetivos: true,
        },
      ],
    };
    const r = interpretarPlantillaObjetivos(
      [
        ["Ámbito", "Comercial o punto de venta", "Id", "Grupo: Renove"],
        ["Comercial", "Ana García", "u_ana", "7"],
      ],
      dosCategorias,
    );
    expect(r.cambios).toEqual([
      expect.objectContaining({
        sujetoId: "u_ana",
        articuloId: null,
        categoria: null,
        subcategoria: "Renove",
        cantidad: 7,
      }),
    ]);
    expect(r.columnasIgnoradas).toEqual([]);

    // Cabecera del formato antiguo, con la categoría delante.
    const antigua = interpretarPlantillaObjetivos(
      [
        ["Ámbito", "Comercial o punto de venta", "Id", "Grupo: Energía → Renove"],
        ["Comercial", "Ana García", "u_ana", "5"],
      ],
      dosCategorias,
    );
    expect(antigua.cambios).toEqual([
      expect.objectContaining({ subcategoria: "Renove", categoria: null, cantidad: 5 }),
    ]);
    expect(antigua.columnasIgnoradas).toEqual([]);
  });

  it("una cantidad que no es un número entero se cuenta como casilla ignorada", () => {
    const r = interpretarPlantillaObjetivos(
      [cabecera, ["Comercial", "Ana García", "u_ana", "muchas", "12"]],
      ctx,
    );
    expect(r.cambios).toHaveLength(1);
    expect(r.ignoradas).toHaveLength(1);
    expect(r.ignoradas[0].motivo).toContain("Unidades totales");
  });

  it("sin fila de encabezados no se adivina nada", () => {
    const r = interpretarPlantillaObjetivos([["Ana García", "40"]], ctx);
    expect(r.cabeceraEncontrada).toBe(false);
    expect(r.cambios).toEqual([]);
  });
});

/**
 * Tercer ámbito de la hoja: los grupos de objetivos del cliente (TMT,
 * televenta…). La columna "Ámbito" dice "Grupo" y el resto de la fila se lee
 * igual que la de un comercial o la de una sede (ticket ff5ab304).
 */
describe("grupos de objetivos en la plantilla (ticket ff5ab304)", () => {
  const ctxConGrupos = { ...ctx, grupos: [{ id: "g_tmt", nombre: "TMT" }] };
  const cabecera = [
    "Ámbito",
    "Comercial, punto de venta o grupo",
    "Id",
    "Unidades totales",
    "Grupo: Hogar",
    "Alta de fibra",
  ];

  it("baja una fila por grupo, con su ámbito escrito", () => {
    const columnas = columnasPlantilla(catalogo);
    const filas = filasPlantilla(
      [...sujetos, { ambito: "grupo" as const, id: "g_tmt", nombre: "TMT" }],
      columnas,
      [objetivo({ id: "o1", grupoId: "g_tmt", cantidad: 200 })],
    );
    expect(filas[2]).toEqual(["Grupo", "TMT", "g_tmt", 200, ""]);
    // Y no se cuela en las filas de los otros ámbitos.
    expect(filas[0][3]).toBe("");
    expect(filas[1][3]).toBe("");
  });

  it("lee una fila de grupo por su id", () => {
    const r = interpretarPlantillaObjetivos(
      [cabecera, ["Grupo", "TMT", "g_tmt", "200", "80"]],
      ctxConGrupos,
    );
    expect(r.cambios).toEqual([
      expect.objectContaining({ ambito: "grupo", sujetoId: "g_tmt", cantidad: 200 }),
      expect.objectContaining({ ambito: "grupo", ...HOGAR, cantidad: 80 }),
    ]);
  });

  it("sin id busca el grupo por su nombre", () => {
    const r = interpretarPlantillaObjetivos(
      [cabecera, ["grupo", "tmt", "", "150", "", ""]],
      ctxConGrupos,
    );
    expect(r.cambios[0]).toMatchObject({ ambito: "grupo", sujetoId: "g_tmt", cantidad: 150 });
  });

  it("un grupo que no existe se ignora y lo dice", () => {
    const r = interpretarPlantillaObjetivos(
      [cabecera, ["Grupo", "Inventado", "", "10", "", ""]],
      ctxConGrupos,
    );
    expect(r.cambios).toHaveLength(0);
    expect(r.ignoradas[0].motivo).toContain("los grupos de objetivos");
  });

  it("una hoja vieja sin grupos se sigue importando igual", () => {
    const r = interpretarPlantillaObjetivos(
      [
        ["Ámbito", "Comercial o punto de venta", "Id", "Unidades totales"],
        ["Comercial", "Ana García", "u_ana", "40"],
      ],
      ctx,
    );
    expect(r.cambios[0]).toMatchObject({ ambito: "comercial", sujetoId: "u_ana", cantidad: 40 });
  });
});

describe("viaje completo por un .xlsx de verdad", () => {
  it("lo que se descarga se vuelve a leer igual", async () => {
    const columnas = columnasPlantilla(catalogo);
    const filas = filasPlantilla(
      [...sujetos, { ambito: "grupo" as const, id: "g_tmt", nombre: "TMT" }],
      columnas,
      [
        objetivo({ id: "o1", userId: "u_ana", ...HOGAR, cantidad: 12 }),
        objetivo({ id: "o2", tiendaId: "t1", cantidad: 90 }),
        objetivo({ id: "o3", grupoId: "g_tmt", cantidad: 200 }),
      ],
    );
    const xlsx = await generarPlantillaObjetivos({ mes: "2026-07", columnas, filas });

    const matriz = await leerHojaExcel(xlsx);
    expect(leerMesPlantilla(matriz)).toBe("2026-07");

    const r = interpretarPlantillaObjetivos(matriz, {
      ...ctx,
      grupos: [{ id: "g_tmt", nombre: "TMT" }],
    });
    expect(r.cabeceraEncontrada).toBe(true);
    expect(r.ignoradas).toEqual([]);
    expect(r.columnasIgnoradas).toEqual([]);
    expect(r.cambios).toEqual([
      expect.objectContaining({ ambito: "comercial", sujetoId: "u_ana", ...HOGAR, articuloId: null, cantidad: 12 }),
      expect.objectContaining({ ambito: "sede", sujetoId: "t1", articuloId: null, categoria: null, cantidad: 90 }),
      expect.objectContaining({ ambito: "grupo", sujetoId: "g_tmt", articuloId: null, categoria: null, cantidad: 200 }),
    ]);
  });
});

describe("el objetivo del operador en la hoja (ticket 5d8b21c7)", () => {
  const SEDE_PROPIA = { ambito: "sede" as const, id: "t1", nombre: "Centro" };
  const SEDE_TMT = { ...SEDE_PROPIA, fuente: "tmt" as const };

  it("cada punto de venta baja dos veces, y cada fila lleva su cifra", () => {
    const columnas = columnasPlantilla(catalogo);
    const filas = filasPlantilla([SEDE_PROPIA, SEDE_TMT], columnas, [
      objetivo({ id: "o_propio", tiendaId: "t1", ...HOGAR, cantidad: 10 }),
      objetivo({ id: "o_tmt", tiendaId: "t1", ...HOGAR, fuente: "tmt", cantidad: 15 }),
    ]);
    // [Ámbito, nombre, id, unidades totales, grupo Hogar]
    expect(filas[0]).toEqual(["Sede", "Centro", "t1", "", 10]);
    expect(filas[1]).toEqual(["TMT punto de venta", "Centro", "t1", "", 15]);
  });

  it("la fila del operador se lee como suya, aunque el id sea el de la tienda", () => {
    const r = interpretarPlantillaObjetivos(
      [
        ["Ámbito", "Comercial o punto de venta", "Id", "Unidades totales", "Grupo: Hogar"],
        ["Sede", "Centro", "t1", "", "10"],
        ["TMT punto de venta", "Centro", "t1", "", "15"],
      ],
      ctx,
    );
    expect(r.ignoradas).toEqual([]);
    expect(r.cambios).toEqual([
      expect.objectContaining({ ambito: "sede", sujetoId: "t1", fuente: "propio", cantidad: 10 }),
      expect.objectContaining({ ambito: "sede", sujetoId: "t1", fuente: "tmt", cantidad: 15 }),
    ]);
  });

  it("la misma tienda en las dos filas no es un duplicado", () => {
    const r = interpretarPlantillaObjetivos(
      [
        ["Ámbito", "Comercial o punto de venta", "Id", "Grupo: Hogar"],
        ["Sede", "Centro", "t1", "10"],
        ["TMT", "Centro", "t1", "15"],
      ],
      ctx,
    );
    expect(r.cambios).toHaveLength(2);
    expect(r.ignoradas).toEqual([]);
  });

  it("un ámbito que no se entiende dice las cuatro opciones", () => {
    const r = interpretarPlantillaObjetivos(
      [
        ["Ámbito", "Comercial o punto de venta", "Id", "Grupo: Hogar"],
        ["Vete a saber", "Centro", "", "10"],
      ],
      ctx,
    );
    expect(r.cambios).toHaveLength(0);
    expect(r.ignoradas[0].motivo).toContain("TMT punto de venta");
  });
});
