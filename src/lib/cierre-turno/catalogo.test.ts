import { describe, it, expect } from "vitest";
import {
  agruparCatalogo,
  aplanarCatalogo,
  construirCatalogo,
  parsearCSV,
  parsearPrecio,
  claveArticulo,
  emparejarCatalogo,
  normalizarNombreArticulo,
  normalizarCategoriaArticulo,
  CATALOGO_MAX_FILAS,
  CATALOGO_NOMBRE_MAX,
  moverEnOrden,
  validarOrdenCatalogo,
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
    expect(claveArticulo({ nombre: "Energía" })).toBe(claveArticulo({ nombre: "  ENERGIA  " }));
    expect(claveArticulo({ nombre: "Alta de fibra" })).toBe(
      claveArticulo({ nombre: "alta  de  FIBRA" }),
    );
    expect(claveArticulo({ nombre: "Renove", categoria: "Telefonía" })).toBe(
      claveArticulo({ nombre: "renove", categoria: " TELEFONIA " }),
    );
  });

  it("distingue artículos que de verdad son distintos", () => {
    expect(claveArticulo({ nombre: "Pospago" })).not.toBe(claveArticulo({ nombre: "Prepago" }));
  });

  it("el mismo nombre en otra categoría o subcategoría es otro artículo", () => {
    const telefonia = claveArticulo({ nombre: "Renove", categoria: "Telefonía" });
    expect(telefonia).not.toBe(claveArticulo({ nombre: "Renove", categoria: "Energía" }));
    expect(telefonia).not.toBe(claveArticulo({ nombre: "Renove" }));
    expect(telefonia).not.toBe(
      claveArticulo({ nombre: "Renove", categoria: "Telefonía", subcategoria: "Pospago" }),
    );
  });

  it("no confunde el nombre con la categoría al pegarlos", () => {
    expect(claveArticulo({ nombre: "Fibra", categoria: "Hogar" })).not.toBe(
      claveArticulo({ nombre: "Fibra Hogar" }),
    );
  });
});

describe("emparejarCatalogo", () => {
  const previos = [
    { id: "art_1", nombre: "Renove", categoria: "Telefonía", subcategoria: null },
    { id: "art_2", nombre: "Fibra", categoria: "Hogar", subcategoria: null },
  ];

  it("casa por nombre y categoría", () => {
    const r = emparejarCatalogo(
      [{ nombre: "renove", categoria: "TELEFONÍA", subcategoria: null }],
      previos,
    );
    expect(r[0]?.existente?.id).toBe("art_1");
  });

  it("el mismo nombre en otra categoría es un artículo nuevo si el suyo ya está casado", () => {
    const r = emparejarCatalogo(
      [
        { nombre: "Renove", categoria: "Telefonía", subcategoria: null },
        { nombre: "Renove", categoria: "Energía", subcategoria: null },
      ],
      previos,
    );
    expect(r[0]?.existente?.id).toBe("art_1");
    expect(r[1]?.existente).toBeNull();
  });

  it("recolocar un artículo desde la hoja lo actualiza, no lo clona", () => {
    const r = emparejarCatalogo([{ nombre: "Fibra", categoria: "Fijo", subcategoria: null }], previos);
    expect(r[0]?.existente?.id).toBe("art_2");
  });

  it("con dos candidatos del mismo nombre no adivina: fila nueva", () => {
    const r = emparejarCatalogo([{ nombre: "Renove", categoria: "Fijo", subcategoria: null }], [
      { id: "art_1", nombre: "Renove", categoria: "Telefonía", subcategoria: null },
      { id: "art_3", nombre: "Renove", categoria: "Energía", subcategoria: null },
    ]);
    expect(r[0]?.existente).toBeNull();
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
      { nombre: "Alta de fibra", categoria: "Telefonía", subcategoria: null, orden: 0, precio: null },
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

  it("el mismo nombre en otra categoría no es un repetido", () => {
    const r = construirCatalogo([
      ["Artículo", "Categoría"],
      ["Renove", "Telefonía"],
      ["Renove", "Energía"],
      ["Renove", "telefonia"],
    ]);
    expect(r.filas.map((f) => f.categoria)).toEqual(["Telefonía", "Energía"]);
    expect(r.ignoradas).toHaveLength(1);
    expect(r.ignoradas[0]?.motivo).toContain("Repetido");
  });

  it("ni el mismo nombre y categoría en otra subcategoría", () => {
    const r = construirCatalogo([
      ["Artículo", "Categoría", "Subcategoría"],
      ["Renove", "Telefonía", "Pospago"],
      ["Renove", "Telefonía", "Prepago"],
    ]);
    expect(r.filas).toHaveLength(2);
    expect(r.ignoradas).toHaveLength(0);
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

  it("importa la subcategoría cuando la hoja nombra la columna", () => {
    const r = construirCatalogo([
      ["Artículo", "Categoría", "Subcategoría"],
      ["Alta de fibra", "Telefonía", "Fijo"],
      ["Pospago 20GB", "Telefonía", "Móvil"],
    ]);
    expect(r.filas[0]).toMatchObject({ categoria: "Telefonía", subcategoria: "Fijo" });
    expect(r.filas[1]).toMatchObject({ categoria: "Telefonía", subcategoria: "Móvil" });
  });

  it("reconoce la subcategoría escrita de otras formas, y no la confunde con la categoría", () => {
    const r = construirCatalogo([
      ["Nombre", "Subfamilia", "Familia"],
      ["Alta de fibra", "Fijo", "Telefonía"],
    ]);
    expect(r.filas[0]).toMatchObject({ categoria: "Telefonía", subcategoria: "Fijo" });
  });

  it("sin columna de subcategoría no la adivina por posición", () => {
    // Una tercera columna sin encabezado puede ser cualquier cosa (un precio,
    // una referencia): colarla como subcategoría partiría el catálogo en
    // grupos de uno.
    const r = construirCatalogo([["Alta de fibra", "Telefonía", "29,90"]]);
    expect(r.filas[0]?.subcategoria).toBeNull();
  });
});

describe("agruparCatalogo", () => {
  const art = (nombre: string, categoria: string | null, subcategoria: string | null = null) => ({
    nombre,
    categoria,
    subcategoria,
  });

  it("agrupa por categoría y, dentro, por subcategoría", () => {
    const grupos = agruparCatalogo([
      art("Fibra", "Telefonía", "Fijo"),
      art("Pospago", "Telefonía", "Móvil"),
      art("Portabilidad", "Telefonía", "Móvil"),
      art("Luz", "Energía"),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos[0]?.categoria).toBe("Telefonía");
    expect(grupos[0]?.subgrupos.map((s) => s.subcategoria)).toEqual(["Fijo", "Móvil"]);
    expect(grupos[0]?.subgrupos[1]?.articulos.map((a) => a.nombre)).toEqual([
      "Pospago",
      "Portabilidad",
    ]);
    expect(grupos[1]?.categoria).toBe("Energía");
  });

  it("junta los artículos de un mismo grupo aunque estén repartidos por la lista", () => {
    const grupos = agruparCatalogo([
      art("Fibra", "Telefonía"),
      art("Luz", "Energía"),
      art("Pospago", "Telefonía"),
    ]);
    expect(grupos.map((g) => g.categoria)).toEqual(["Telefonía", "Energía"]);
    expect(grupos[0]?.subgrupos[0]?.articulos.map((a) => a.nombre)).toEqual(["Fibra", "Pospago"]);
  });

  it("no crea grupos gemelos por tildes o mayúsculas", () => {
    const grupos = agruparCatalogo([art("Fibra", "Telefonía"), art("Pospago", "telefonia")]);
    expect(grupos).toHaveLength(1);
    // Se muestra la primera forma escrita.
    expect(grupos[0]?.categoria).toBe("Telefonía");
  });

  it("lo que no tiene categoría o subcategoría se queda en su propio bloque", () => {
    const grupos = agruparCatalogo([art("Suelto", null), art("Fibra", "Telefonía", "Fijo")]);
    expect(grupos[0]?.categoria).toBeNull();
    expect(grupos[0]?.subgrupos[0]?.subcategoria).toBeNull();
  });

  it("aplanado devuelve todos los artículos, en el orden de la tabla", () => {
    const articulos = [
      art("Fibra", "Telefonía"),
      art("Luz", "Energía"),
      art("Pospago", "Telefonía"),
    ];
    expect(aplanarCatalogo(agruparCatalogo(articulos)).map((a) => a.nombre)).toEqual([
      "Fibra",
      "Pospago",
      "Luz",
    ]);
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

describe("moverEnOrden", () => {
  const ids = ["a", "b", "c"];

  it("sube un artículo una posición", () => {
    expect(moverEnOrden(ids, "c", -1)).toEqual(["a", "c", "b"]);
  });

  it("baja un artículo una posición", () => {
    expect(moverEnOrden(ids, "a", 1)).toEqual(["b", "a", "c"]);
  });

  it("no se sale por los extremos ni toca la lista original", () => {
    expect(moverEnOrden(ids, "a", -1)).toBeNull();
    expect(moverEnOrden(ids, "c", 1)).toBeNull();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("un id que no está en la lista no mueve nada", () => {
    expect(moverEnOrden(ids, "z", -1)).toBeNull();
  });
});

describe("validarOrdenCatalogo", () => {
  it("acepta el catálogo entero en otro orden", () => {
    expect(validarOrdenCatalogo(["c", "a", "b"], ["a", "b", "c"])).toEqual({
      ok: true,
      ids: ["c", "a", "b"],
    });
  });

  it("rechaza lo que no es una lista de ids", () => {
    expect(validarOrdenCatalogo("a,b", ["a", "b"])).toMatchObject({ ok: false, estado: "malformado" });
    expect(validarOrdenCatalogo([1, 2], ["a", "b"])).toMatchObject({ ok: false, estado: "malformado" });
    expect(validarOrdenCatalogo(["a", "a"], ["a", "b"])).toMatchObject({
      ok: false,
      estado: "malformado",
    });
  });

  it("si falta o sobra un artículo, el orden viene de una pantalla desfasada", () => {
    // Otra pestaña ha añadido o desactivado algo mientras se ordenaba: guardar
    // esta lista dejaría al artículo nuevo con la posición de otro.
    expect(validarOrdenCatalogo(["a"], ["a", "b"])).toMatchObject({ ok: false, estado: "desfasado" });
    expect(validarOrdenCatalogo(["a", "b", "c"], ["a", "b"])).toMatchObject({
      ok: false,
      estado: "desfasado",
    });
    expect(validarOrdenCatalogo(["a", "z"], ["a", "b"])).toMatchObject({
      ok: false,
      estado: "desfasado",
    });
  });
});
