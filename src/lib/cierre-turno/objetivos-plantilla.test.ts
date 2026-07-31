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
import type { ObjetivoFila } from "./objetivos";

const catalogo: ArticuloPlantilla[] = [
  { id: "art_fibra", nombre: "Alta de fibra", categoria: "Telefonía", cuentaParaObjetivos: true },
  { id: "art_movil", nombre: "Portabilidad", categoria: "Telefonía", cuentaParaObjetivos: true },
  { id: "art_funda", nombre: "Funda", categoria: "Accesorios", cuentaParaObjetivos: false },
];

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
  it("lleva unidades totales, un grupo por categoría y un producto por artículo", () => {
    expect(columnasPlantilla(catalogo).map((c) => c.titulo)).toEqual([
      "Unidades totales",
      "Grupo: Telefonía",
      "Alta de fibra",
      "Portabilidad",
    ]);
  });

  it("un artículo que no cuenta para objetivos no tiene columna", () => {
    const ids = columnasPlantilla(catalogo).map((c) => c.id);
    expect(ids).not.toContain("art_funda");
    // Y su grupo tampoco: no queda ningún producto que lo empuje.
    expect(ids).not.toContain("cat:Accesorios");
  });
});

describe("filasPlantilla", () => {
  it("rellena cada casilla con el objetivo fijado de ese sujeto y esa columna", () => {
    const columnas = columnasPlantilla(catalogo);
    const filas = filasPlantilla(sujetos, columnas, [
      objetivo({ id: "o1", userId: "u_ana", articuloId: "art_fibra", cantidad: 12 }),
      objetivo({ id: "o2", userId: "u_ana", categoria: "Telefonía", cantidad: 20 }),
      objetivo({ id: "o3", tiendaId: "t1", cantidad: 90 }),
    ]);

    // [Ámbito, nombre, id, totales, grupo, fibra, portabilidad]
    expect(filas[0]).toEqual(["Comercial", "Ana García", "u_ana", "", 20, 12, ""]);
    expect(filas[1]).toEqual(["Sede", "Centro", "t1", 90, "", "", ""]);
  });

  it("no mezcla los objetivos de la sede con los del comercial", () => {
    const columnas = columnasPlantilla(catalogo);
    const filas = filasPlantilla(sujetos, columnas, [
      objetivo({ id: "o1", tiendaId: "t1", articuloId: "art_fibra", cantidad: 50 }),
    ]);
    expect(filas[0][5]).toBe(""); // el comercial sigue sin objetivo de fibra
    expect(filas[1][5]).toBe(50);
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
  const cabecera = [
    "Ámbito",
    "Comercial o punto de venta",
    "Id",
    "Unidades totales",
    "Grupo: Telefonía",
    "Alta de fibra",
  ];

  it("lee la hoja tal cual baja y devuelve los objetivos a fijar", () => {
    const r = interpretarPlantillaObjetivos(
      [["Mes", "2026-07"], cabecera, ["Comercial", "Ana García", "u_ana", "40", "20", "12"]],
      ctx,
    );
    expect(r.cabeceraEncontrada).toBe(true);
    expect(r.mes).toBe("2026-07");
    expect(r.cambios).toEqual([
      expect.objectContaining({ ambito: "comercial", sujetoId: "u_ana", articuloId: null, categoria: null, cantidad: 40 }),
      expect.objectContaining({ categoria: "Telefonía", articuloId: null, cantidad: 20 }),
      expect.objectContaining({ articuloId: "art_fibra", categoria: null, cantidad: 12 }),
    ]);
  });

  it("una casilla vacía no toca nada y el 0 quita el objetivo", () => {
    const r = interpretarPlantillaObjetivos(
      [cabecera, ["Comercial", "Ana García", "u_ana", "", "", "0"]],
      ctx,
    );
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]).toMatchObject({ articuloId: "art_fibra", cantidad: 0 });
  });

  it("el id manda sobre el nombre y sobre el ámbito escrito", () => {
    const r = interpretarPlantillaObjetivos(
      [cabecera, ["Comercial", "Nombre viejo", "t1", "90", "", ""]],
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
        ["Comercial", "Quien sea", "", "10", "", ""],
        ["Comercial", "Ana García", "u_ana", "40", "", ""],
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

  it("una cantidad que no es un número entero se cuenta como casilla ignorada", () => {
    const r = interpretarPlantillaObjetivos(
      [cabecera, ["Comercial", "Ana García", "u_ana", "muchas", "", "12"]],
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

describe("viaje completo por un .xlsx de verdad", () => {
  it("lo que se descarga se vuelve a leer igual", async () => {
    const columnas = columnasPlantilla(catalogo);
    const filas = filasPlantilla(sujetos, columnas, [
      objetivo({ id: "o1", userId: "u_ana", articuloId: "art_fibra", cantidad: 12 }),
      objetivo({ id: "o2", tiendaId: "t1", cantidad: 90 }),
    ]);
    const xlsx = await generarPlantillaObjetivos({ mes: "2026-07", columnas, filas });

    const matriz = await leerHojaExcel(xlsx);
    expect(leerMesPlantilla(matriz)).toBe("2026-07");

    const r = interpretarPlantillaObjetivos(matriz, ctx);
    expect(r.cabeceraEncontrada).toBe(true);
    expect(r.ignoradas).toEqual([]);
    expect(r.columnasIgnoradas).toEqual([]);
    expect(r.cambios).toEqual([
      expect.objectContaining({ ambito: "comercial", sujetoId: "u_ana", articuloId: "art_fibra", cantidad: 12 }),
      expect.objectContaining({ ambito: "sede", sujetoId: "t1", articuloId: null, categoria: null, cantidad: 90 }),
    ]);
  });
});
