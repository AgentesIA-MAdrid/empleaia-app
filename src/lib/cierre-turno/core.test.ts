import { describe, it, expect } from "vitest";
import {
  alcanceSegunRol,
  filtroSede,
  whereSede,
  puedeVerObjetivos,
  puedeVerConciliacion,
  puedeFijarObjetivos,
  puedeEditarCaja,
  mesDe,
  consecucion,
  diferenciaArqueo,
  esDescuadre,
  pasosPendientes,
  estaCompleto,
  normalizarVentas,
  normalizarImporte,
  normalizarIncidencia,
  normalizarMotivoEdicion,
  adjuntoAceptado,
  MAX_ADJUNTO_BYTES,
  diaMadrid,
} from "./core";

describe("alcance por rol", () => {
  it("el comercial solo ve lo suyo", () => {
    expect(alcanceSegunRol("EMPLEADO")).toBe("propio");
  });

  it("el coordinador ve su sede (para poder apretar)", () => {
    expect(alcanceSegunRol("MANAGER")).toBe("sede");
  });

  it("el administrador lo ve todo", () => {
    expect(alcanceSegunRol("OWNER")).toBe("todos");
  });

  it("un rol desconocido no ve más de lo suyo", () => {
    expect(alcanceSegunRol("CUALQUIERA")).toBe("propio");
  });
});

describe("quién entra en cada área", () => {
  it("objetivos: coordinadores y administradores, no el comercial", () => {
    expect(puedeVerObjetivos("OWNER")).toBe(true);
    expect(puedeVerObjetivos("MANAGER")).toBe(true);
    expect(puedeVerObjetivos("EMPLEADO")).toBe(false);
  });

  it("fijar objetivos es solo de administración", () => {
    expect(puedeFijarObjetivos("OWNER")).toBe(true);
    expect(puedeFijarObjetivos("MANAGER")).toBe(false);
  });

  it("conciliación: solo administración", () => {
    expect(puedeVerConciliacion("OWNER")).toBe(true);
    expect(puedeVerConciliacion("MANAGER")).toBe(false);
    expect(puedeVerConciliacion("EMPLEADO")).toBe(false);
  });
});

describe("edición del cierre de caja", () => {
  it("el comercial corrige su borrador", () => {
    expect(puedeEditarCaja("EMPLEADO", false, true)).toBe(true);
  });

  it("una vez confirmado, el comercial ya no puede tocarlo", () => {
    expect(puedeEditarCaja("EMPLEADO", true, true)).toBe(false);
  });

  it("nadie edita el borrador de otro", () => {
    expect(puedeEditarCaja("EMPLEADO", false, false)).toBe(false);
    expect(puedeEditarCaja("MANAGER", false, false)).toBe(false);
  });

  it("el administrador sí, confirmado o no (y queda rastro)", () => {
    expect(puedeEditarCaja("OWNER", true, false)).toBe(true);
    expect(puedeEditarCaja("OWNER", false, false)).toBe(true);
  });
});

describe("consecución de objetivos", () => {
  it("calcula el porcentaje con un decimal", () => {
    expect(consecucion(15, 30)).toBe(50);
    expect(consecucion(7, 30)).toBe(23.3);
  });

  it("sin objetivo devuelve null, no 0 ni 100", () => {
    // Mostrar "0 %" cuando nadie fijó objetivo engaña; dividir entre cero, peor.
    expect(consecucion(10, 0)).toBeNull();
    expect(consecucion(10, Number.NaN)).toBeNull();
  });

  it("permite pasar del 100 %", () => {
    expect(consecucion(45, 30)).toBe(150);
  });
});

describe("arqueos", () => {
  it("sobra efectivo → diferencia positiva", () => {
    expect(diferenciaArqueo(520.5, 500)).toBe(20.5);
  });

  it("falta efectivo → diferencia negativa", () => {
    expect(diferenciaArqueo(480, 500)).toBe(-20);
  });

  it("los céntimos de redondeo no son descuadre", () => {
    expect(esDescuadre(0.4)).toBe(false);
    expect(esDescuadre(-0.99)).toBe(false);
  });

  it("desde un euro sí, en los dos sentidos", () => {
    expect(esDescuadre(1)).toBe(true);
    expect(esDescuadre(-12.3)).toBe(true);
  });

  it("el umbral es configurable", () => {
    expect(esDescuadre(5, 10)).toBe(false);
  });
});

describe("pasos pendientes de un cierre", () => {
  const completo = {
    ventas: 3,
    detalleJornada: "Dos altas y una portabilidad",
    cajaConfirmada: true,
    completadoEn: new Date("2026-07-29T21:00:00Z"),
  };

  it("un cierre terminado no tiene pendientes", () => {
    expect(pasosPendientes(completo)).toEqual([]);
    expect(estaCompleto(completo)).toBe(true);
  });

  it("sin ventas ni detalle, falta el primer paso", () => {
    expect(pasosPendientes({ ...completo, ventas: 0, detalleJornada: null })).toContain("ventas");
  });

  it("solo con el detalle escrito, el paso 1 cuenta como hecho", () => {
    // Un día sin ventas es un dato válido: lo que no vale es no registrar nada.
    expect(pasosPendientes({ ...completo, ventas: 0 })).toEqual([]);
  });

  it("sin caja confirmada y sin cerrar, faltan los dos", () => {
    const pend = pasosPendientes({ ...completo, cajaConfirmada: false, completadoEn: null });
    expect(pend).toEqual(["caja", "incidencias"]);
    expect(estaCompleto({ ...completo, cajaConfirmada: false, completadoEn: null })).toBe(false);
  });
});

describe("mes de una fecha", () => {
  it("formatea YYYY-MM", () => {
    expect(mesDe(new Date(2026, 6, 29))).toBe("2026-07");
    expect(mesDe(new Date(2026, 11, 1))).toBe("2026-12");
  });
});

describe("normalizarVentas", () => {
  const catalogo = [
    { id: "a1", nombre: "Alta de fibra" },
    { id: "a2", nombre: "Portabilidad" },
  ];

  it("acepta cantidades válidas y descarta los ceros", () => {
    // Guardar ceros llena la tabla de filas que no cambian ningún total.
    const r = normalizarVentas(catalogo, [
      { articuloId: "a1", cantidad: 3 },
      { articuloId: "a2", cantidad: 0 },
    ]);
    expect(r.ventas).toEqual([{ articuloId: "a1", cantidad: 3 }]);
    expect(r.descartadas).toBe(0);
  });

  it("acepta cantidades escritas como texto", () => {
    const r = normalizarVentas(catalogo, [{ articuloId: "a1", cantidad: "7" }]);
    expect(r.ventas).toEqual([{ articuloId: "a1", cantidad: 7 }]);
  });

  it("descarta artículos que no están en el catálogo", () => {
    const r = normalizarVentas(catalogo, [{ articuloId: "inventado", cantidad: 5 }]);
    expect(r.ventas).toEqual([]);
    expect(r.descartadas).toBe(1);
  });

  it("descarta cantidades negativas o decimales", () => {
    const r = normalizarVentas(catalogo, [
      { articuloId: "a1", cantidad: -2 },
      { articuloId: "a2", cantidad: 1.5 },
    ]);
    expect(r.ventas).toEqual([]);
    expect(r.descartadas).toBe(2);
  });

  it("ignora el segundo envío del mismo artículo", () => {
    const r = normalizarVentas(catalogo, [
      { articuloId: "a1", cantidad: 2 },
      { articuloId: "a1", cantidad: 9 },
    ]);
    expect(r.ventas).toEqual([{ articuloId: "a1", cantidad: 2 }]);
    expect(r.descartadas).toBe(1);
  });

  it("sin datos no revienta", () => {
    expect(normalizarVentas(catalogo, undefined).ventas).toEqual([]);
  });
});

describe("normalizarImporte", () => {
  it("acepta euros con dos decimales", () => {
    const r = normalizarImporte("1234.56");
    expect(r).toEqual({ ok: true, importe: 1234.56 });
  });

  it("acepta la coma decimal del móvil", () => {
    expect(normalizarImporte("87,40")).toEqual({ ok: true, importe: 87.4 });
  });

  it("redondea a céntimos", () => {
    expect(normalizarImporte(10.999)).toEqual({ ok: true, importe: 11 });
  });

  it("rechaza negativos, texto y disparates", () => {
    expect(normalizarImporte(-1).ok).toBe(false);
    expect(normalizarImporte("hola").ok).toBe(false);
    expect(normalizarImporte(9_999_999).ok).toBe(false);
  });
});

describe("normalizarIncidencia", () => {
  it("sin incidencia devuelve null", () => {
    expect(normalizarIncidencia(false, "")).toEqual({ ok: true, incidencia: null });
  });

  it("con incidencia exige contar qué pasó", () => {
    // Un "sí" sin texto no le sirve de nada a quien recibe el aviso.
    expect(normalizarIncidencia(true, "").ok).toBe(false);
    expect(normalizarIncidencia(true, "ups").ok).toBe(false);
  });

  it("con texto suficiente lo recorta y lo acepta", () => {
    const r = normalizarIncidencia(true, "  Falta un terminal del expositor  ");
    expect(r).toEqual({ ok: true, incidencia: "Falta un terminal del expositor" });
  });
});

describe("adjuntos", () => {
  const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  it("acepta Excel, PDF y fotos dentro del tamaño", () => {
    expect(adjuntoAceptado(xlsx, 500_000).ok).toBe(true);
    expect(adjuntoAceptado("image/jpeg", 2_000_000).ok).toBe(true);
    expect(adjuntoAceptado("application/pdf", 100).ok).toBe(true);
  });

  it("rechaza formatos raros", () => {
    expect(adjuntoAceptado("application/x-msdownload", 1000).ok).toBe(false);
  });

  it("rechaza vacíos y lo que pasa de 10 MB", () => {
    expect(adjuntoAceptado(xlsx, 0).ok).toBe(false);
    expect(adjuntoAceptado(xlsx, MAX_ADJUNTO_BYTES + 1).ok).toBe(false);
  });
});

describe("motivo de la corrección de un administrador", () => {
  it("es obligatorio y con contenido", () => {
    expect(normalizarMotivoEdicion("").ok).toBe(false);
    expect(normalizarMotivoEdicion("err").ok).toBe(false);
    expect(normalizarMotivoEdicion("Contó mal el efectivo del cajón")).toEqual({
      ok: true,
      motivo: "Contó mal el efectivo del cajón",
    });
  });
});

describe("día del cierre en hora de Madrid", () => {
  it("un cierre a las 00:30 de Madrid es de ese día, no del anterior", () => {
    // 2026-07-30T00:30 en Madrid (CEST, +02:00) = 2026-07-29T22:30Z.
    expect(diaMadrid(new Date("2026-07-29T22:30:00Z"))).toBe("2026-07-30");
  });

  it("a las 23:00 de Madrid sigue siendo el mismo día", () => {
    expect(diaMadrid(new Date("2026-07-30T21:00:00Z"))).toBe("2026-07-30");
  });

  it("funciona igual en invierno (CET, +01:00)", () => {
    expect(diaMadrid(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-16");
  });
});

describe("filtroSede — por qué sedes filtra cada rol", () => {
  it("administración lo ve todo, y puede pedir una sede", () => {
    expect(filtroSede("OWNER", [], null)).toEqual({ tipo: "todas" });
    expect(filtroSede("OWNER", [], "t9")).toEqual({ tipo: "sedes", tiendaIds: ["t9"] });
  });

  it("el coordinador ve TODAS las sedes que lleva (ticket 73)", () => {
    expect(filtroSede("MANAGER", ["t1", "t2", "t3"], null)).toEqual({
      tipo: "sedes",
      tiendaIds: ["t1", "t2", "t3"],
    });
  });

  it("puede afinar a una de sus sedes, pero no salirse de ellas", () => {
    expect(filtroSede("MANAGER", ["t1", "t2"], "t2")).toEqual({ tipo: "sedes", tiendaIds: ["t2"] });
    // Pide una sede que no lleva: se ignora y sigue viendo las suyas, nunca la ajena.
    expect(filtroSede("MANAGER", ["t1", "t2"], "t9")).toEqual({
      tipo: "sedes",
      tiendaIds: ["t1", "t2"],
    });
  });

  it("un comercial, igual", () => {
    expect(filtroSede("EMPLEADO", ["t1"], "t9")).toEqual({ tipo: "sedes", tiendaIds: ["t1"] });
  });

  it("con alcance de sede y SIN sedes asignadas no ve todas: no ve ninguna", () => {
    // El bug que esto cierra: construir el where con
    // `...(tiendaId ? { tiendaId } : {})` hace desaparecer el filtro con null,
    // y esa persona termina viendo la caja de todas las tiendas.
    expect(filtroSede("MANAGER", [], null)).toEqual({ tipo: "ninguna" });
    expect(filtroSede("EMPLEADO", [], "t9")).toEqual({ tipo: "ninguna" });
  });

  it("no repite sedes duplicadas", () => {
    expect(filtroSede("MANAGER", ["t1", "t1", "t2"], null)).toEqual({
      tipo: "sedes",
      tiendaIds: ["t1", "t2"],
    });
  });
});

describe("whereSede — traducción a cláusula Prisma", () => {
  it("sin filtro cuando se ve todo", () => {
    expect(whereSede({ tipo: "todas" })).toEqual({});
  });

  it("filtra por las sedes del alcance", () => {
    expect(whereSede({ tipo: "sedes", tiendaIds: ["t1", "t2"] })).toEqual({
      tiendaId: { in: ["t1", "t2"] },
    });
  });
});
