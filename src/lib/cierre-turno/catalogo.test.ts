import { describe, it, expect } from "vitest";
import {
  construirCatalogo,
  parsearCSV,
  parsearPrecio,
  claveArticulo,
  normalizarNombreArticulo,
  normalizarCategoriaArticulo,
  CATALOGO_MAX_FILAS,
  CATALOGO_NOMBRE_MAX,
} from "./catalogo";

describe("normalizarNombreArticulo", () => {
  it("colapsa espacios y recorta", () => {
    const r = normalizarNombreArticulo("  Alta   de   fibra  ");
    expect(r).toEqual({ ok: true, nombre: "Alta de fibra" });
  });

  it("rechaza lo que no llega a nombre, y dice por qué", () => {
    expect(normalizarNombreArticulo("")).toMatchObject({ ok: false });
    expect(normalizarNombreArticulo(" a ")).toMatchObject({ ok: false });
    expect(normalizarNombreArticulo(undefined)).toMatchObject({ ok: false });
    expect(normalizarNombreArticulo(42)).toMatchObject({ ok: false });
  });

  it("rechaza nombres desmedidos", () => {
    const r = normalizarNombreArticulo("x".repeat(CATALOGO_NOMBRE_MAX + 1));
    expect(r.ok).toBe(false);
  });
});

describe("normalizarCategoriaArticulo", () => {
  it("vacía es sin categoría, no cadena vacía", () => {
    expect(normalizarCategoriaArticulo("   ")).toBeNull();
    expect(normalizarCategoriaArticulo(undefined)).toBeNull();
  });

  it("recorta y colapsa espacios", () => {
    expect(normalizarCategoriaArticulo("  Telefonía   móvil ")).toBe("Telefonía móvil");
  });
});

describe("claveArticulo", () => {
  it("da la misma clave cambien tildes, mayúsculas o espacios", () => {
    expect(claveArticulo("Energía")).toBe(claveArticulo("  ENERGIA  "));
    expect(claveArticulo("Alta de fibra")).toBe(claveArticulo("alta  de  FIBRA"));
  });

  it("distingue artículos que de verdad son distintos", () => {
    expect(claveArticulo("Pospago")).not.toBe(claveArticulo("Prepago"));
  });
});

describe("parsearCSV", () => {
  it("separa por comas", () => {
    expect(parsearCSV("Alta fibra,Telefonía\nPortabilidad,Telefonía")).toEqual([
      ["Alta fibra", "Telefonía"],
      ["Portabilidad", "Telefonía"],
    ]);
  });

  it("separa por punto y coma, que es como exporta Excel en España", () => {
    expect(parsearCSV("Alta fibra;Telefonía")).toEqual([["Alta fibra", "Telefonía"]]);
  });

  it("respeta las comas dentro de comillas", () => {
    expect(parsearCSV('"Router, instalación incluida",Servicios')).toEqual([
      ["Router, instalación incluida", "Servicios"],
    ]);
  });

  it("entiende las comillas escapadas", () => {
    expect(parsearCSV('"Tarifa ""todo incluido""",Móvil')).toEqual([['Tarifa "todo incluido"', "Móvil"]]);
  });

  it("aguanta el BOM y los saltos de Windows", () => {
    expect(parsearCSV("﻿Alta,Telefonía\r\nPorta,Telefonía")).toEqual([
      ["Alta", "Telefonía"],
      ["Porta", "Telefonía"],
    ]);
  });
});

describe("construirCatalogo", () => {
  it("detecta el encabezado y no lo cuenta como artículo", () => {
    const r = construirCatalogo([
      ["Artículo", "Categoría"],
      ["Alta de fibra", "Telefonía"],
    ]);
    expect(r.conCabecera).toBe(true);
    expect(r.filas).toEqual([
      { nombre: "Alta de fibra", categoria: "Telefonía", orden: 0, precio: null },
    ]);
  });

  it("reconoce encabezados sin tildes y en cualquier caja", () => {
    const r = construirCatalogo([
      ["NOMBRE", "FAMILIA"],
      ["Portabilidad", "Móvil"],
    ]);
    expect(r.conCabecera).toBe(true);
    expect(r.filas[0]).toMatchObject({ nombre: "Portabilidad", categoria: "Móvil" });
  });

  it("sin encabezado, la primera fila también es artículo", () => {
    // Si el cliente no pone encabezados, perder su primer artículo sería un
    // error silencioso difícil de detectar.
    const r = construirCatalogo([["Alta de fibra", "Telefonía"], ["Portabilidad", "Móvil"]]);
    expect(r.conCabecera).toBe(false);
    expect(r.filas).toHaveLength(2);
  });

  it("mantiene el orden de la hoja", () => {
    const r = construirCatalogo([["C"], ["A"], ["B"]]);
    expect(r.filas.map((f) => f.nombre)).toEqual(["C", "A", "B"]);
    expect(r.filas.map((f) => f.orden)).toEqual([0, 1, 2]);
  });

  it("ignora las filas en blanco del final sin dar guerra", () => {
    const r = construirCatalogo([["Alta"], [""], ["  "], []]);
    expect(r.filas).toHaveLength(1);
    expect(r.ignoradas).toHaveLength(0);
  });

  it("avisa de una fila con datos pero sin nombre", () => {
    const r = construirCatalogo([["", "Telefonía"]]);
    expect(r.filas).toHaveLength(0);
    expect(r.ignoradas[0]?.motivo).toContain("Sin nombre");
  });

  it("descarta repetidos aunque cambien tildes o mayúsculas", () => {
    const r = construirCatalogo([["Alta de fibra"], ["ALTA DE FIBRA"], ["Alta de Fibrá"]]);
    expect(r.filas).toHaveLength(1);
    expect(r.ignoradas).toHaveLength(2);
    expect(r.ignoradas[0]?.motivo).toContain("Repetido");
  });

  it("colapsa los espacios de más", () => {
    const r = construirCatalogo([["  Alta   de   fibra  "]]);
    expect(r.filas[0]?.nombre).toBe("Alta de fibra");
  });

  it("corta por el máximo y lo dice", () => {
    const muchas = Array.from({ length: CATALOGO_MAX_FILAS + 3 }, (_, i) => [`Articulo ${i}`]);
    const r = construirCatalogo(muchas);
    expect(r.filas).toHaveLength(CATALOGO_MAX_FILAS);
    expect(r.ignoradas).toHaveLength(3);
    expect(r.ignoradas[0]?.motivo).toContain("máximo");
  });

  it("rechaza nombres desmedidos", () => {
    const r = construirCatalogo([["x".repeat(200)]]);
    expect(r.filas).toHaveLength(0);
    expect(r.ignoradas[0]?.motivo).toContain("caracteres");
  });

  it("una hoja vacía no revienta", () => {
    expect(construirCatalogo([]).filas).toEqual([]);
  });

  it("con una sola columna, no inventa categoría", () => {
    const r = construirCatalogo([["Alta de fibra"]]);
    expect(r.filas[0]?.categoria).toBeNull();
  });

  it("importa la columna de precio cuando la hoja la nombra", () => {
    const r = construirCatalogo([
      ["Artículo", "Familia", "Precio"],
      ["Alta de fibra", "Telefonía", "29,90 €"],
      ["Portabilidad", "Móvil", ""],
    ]);
    expect(r.filas[0]?.precio).toBe(29.9);
    expect(r.filas[1]?.precio).toBeNull();
  });

  it("sin cabecera de precio no adivina precios por posición", () => {
    // Una segunda columna numérica sin cabecera se sigue tratando como
    // categoría: inventar precios saldría carísimo el día que cuadren caja.
    const r = construirCatalogo([["Alta de fibra", "29,90"]]);
    expect(r.filas[0]?.precio).toBeNull();
    expect(r.filas[0]?.categoria).toBe("29,90");
  });
});

describe("parsearPrecio", () => {
  it("acepta coma decimal, punto decimal y el símbolo del euro", () => {
    expect(parsearPrecio("29,90")).toBe(29.9);
    expect(parsearPrecio("29.90")).toBe(29.9);
    expect(parsearPrecio(" 29,90 € ")).toBe(29.9);
  });

  it("entiende el punto como separador de miles cuando hay coma decimal", () => {
    expect(parsearPrecio("1.234,50")).toBe(1234.5);
  });

  it("redondea a céntimos", () => {
    expect(parsearPrecio("10,999")).toBe(11);
  });

  it("descarta lo que no es un precio", () => {
    expect(parsearPrecio("")).toBeNull();
    expect(parsearPrecio(undefined)).toBeNull();
    expect(parsearPrecio("consultar")).toBeNull();
    expect(parsearPrecio("-5")).toBeNull();
    expect(parsearPrecio("99999999")).toBeNull();
  });

  it("cero es un precio válido: hay servicios gratis", () => {
    expect(parsearPrecio("0")).toBe(0);
  });
});
