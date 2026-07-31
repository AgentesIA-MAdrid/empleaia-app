/**
 * Seguimiento diario de objetivos — lógica pura.
 *
 * Lo que se protege aquí:
 *  1. El día de corte nunca se sale del mes que se mira (ni por delante ni por
 *     detrás): un mes cerrado se cuenta entero, uno futuro no se cuenta.
 *  2. El objetivo "a día de hoy" es el reparto lineal del mes, que es la
 *     referencia con la que se decide si se va por delante o por detrás.
 *  3. El ritmo necesario y la previsión: con el objetivo cumplido no se pide
 *     nada más, y el último día del mes no hay ritmo que calcular.
 *  4. Lo vendido respeta las reglas del módulo: los productos marcados como que
 *     no cuentan para objetivos no empujan ni el total ni su grupo.
 */

import { describe, it, expect } from "vitest";
import { columnaSubgrupo, type ObjetivoFila, type VentaDia } from "@/lib/cierre-turno/objetivos";
import {
  CONCEPTO_TOTAL,
  construirSeguimiento,
  diasDelMes,
  metricasDe,
  normalizarConcepto,
  normalizarDiaCorte,
  progresoDelMes,
  serieDiaria,
  totalesSeguimiento,
} from "@/lib/cierre-turno/seguimiento";

const catalogo = [
  {
    id: "art_fibra",
    nombre: "Alta de fibra",
    categoria: "Telefonía",
    subcategoria: "Hogar",
    cuentaParaObjetivos: true,
  },
  {
    id: "art_pospago",
    nombre: "Pospago",
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

/** Ventas de Ana en la sede t1, con el catálogo ya anotado. */
function venta(fecha: string, articuloId: string | null, cantidad: number): VentaDia {
  const a = catalogo.find((x) => x.id === articuloId);
  return {
    fecha,
    userId: "u_ana",
    tiendaId: "t1",
    articuloId,
    cantidad,
    categoria: a?.categoria ?? null,
    subcategoria: a?.subcategoria ?? null,
    cuentaParaObjetivos: a ? a.cuentaParaObjetivos : true,
  };
}

describe("día de corte", () => {
  it("el mes en curso se cuenta hasta hoy", () => {
    expect(normalizarDiaCorte("2026-07", null, "2026-07-15")).toBe("2026-07-15");
  });

  it("un mes ya cerrado se cuenta entero", () => {
    expect(normalizarDiaCorte("2026-05", null, "2026-07-15")).toBe("2026-05-31");
  });

  it("un mes que no ha empezado se queda en su día 1, sin días transcurridos", () => {
    const corte = normalizarDiaCorte("2026-09", null, "2026-07-15");
    expect(corte).toBe("2026-09-01");
    expect(progresoDelMes("2026-09", corte, "2026-07-15").transcurridos).toBe(0);
  });

  it("no se puede pedir un día posterior a hoy ni anterior al mes", () => {
    expect(normalizarDiaCorte("2026-07", "2026-07-28", "2026-07-15")).toBe("2026-07-15");
    expect(normalizarDiaCorte("2026-07", "2026-06-20", "2026-07-15")).toBe("2026-07-01");
  });

  it("febrero de un año bisiesto tiene 29 días", () => {
    expect(diasDelMes("2028-02")).toBe(29);
    expect(diasDelMes("2026-02")).toBe(28);
  });
});

describe("métricas del día", () => {
  const progreso = progresoDelMes("2026-07", "2026-07-15"); // 15 de 31 días

  it("el objetivo a día de hoy es el reparto lineal del mes", () => {
    const m = metricasDe(310, 100, progreso);
    expect(m.objetivoAlDia).toBe(150);
    expect(m.desviacion).toBe(-50);
    expect(m.consecucion).toBe(32.3);
  });

  it("el ritmo necesario reparte lo que falta entre los días que quedan", () => {
    const m = metricasDe(310, 150, progreso);
    // Faltan 160 unidades en los 16 días que quedan.
    expect(m.ritmoNecesario).toBe(10);
    expect(m.mediaDiaria).toBe(10);
    expect(m.prevision).toBe(310);
  });

  it("con el objetivo cumplido no se pide más ritmo", () => {
    expect(metricasDe(100, 120, progreso).ritmoNecesario).toBe(0);
  });

  it("el último día del mes ya no hay ritmo que calcular", () => {
    const fin = progresoDelMes("2026-07", "2026-07-31");
    expect(metricasDe(310, 100, fin).ritmoNecesario).toBeNull();
    expect(metricasDe(310, 100, fin).objetivoAlDia).toBe(310);
  });

  it("sin objetivo no se inventa ni desviación ni consecución", () => {
    const m = metricasDe(null, 40, progreso);
    expect(m.objetivoAlDia).toBeNull();
    expect(m.desviacion).toBeNull();
    expect(m.consecucion).toBeNull();
  });
});

describe("filas de seguimiento", () => {
  const progreso = progresoDelMes("2026-07", "2026-07-10"); // 10 de 31
  const ventas: VentaDia[] = [
    venta("2026-07-02", "art_fibra", 5),
    venta("2026-07-10", "art_pospago", 3),
    // Marcado como que no cuenta: no empuja ni el total ni su grupo.
    venta("2026-07-10", "art_funda", 40),
  ];
  const objetivos: ObjetivoFila[] = [
    { id: "o1", mes: "2026-07", userId: "u_ana", tiendaId: null, articuloId: null, categoria: null, cantidad: 31 },
    { id: "o2", mes: "2026-07", userId: null, tiendaId: "t1", articuloId: null, categoria: null, cantidad: 62 },
  ];

  it("cuenta lo vendido del mes y lo del propio día de corte", () => {
    const [ana] = construirSeguimiento({
      ambito: "comercial",
      sujetos: [{ id: "u_ana", nombre: "Ana García", sede: "Centro" }],
      objetivos,
      ventas,
      concepto: CONCEPTO_TOTAL,
      progreso,
      articuloIds: ["art_fibra", "art_pospago"],
      catalogo,
    });
    expect(ana.vendido).toBe(8);
    expect(ana.vendidoDelDia).toBe(3);
    expect(ana.objetivo).toBe(31);
    expect(ana.objetivoAlDia).toBe(10);
    expect(ana.desviacion).toBe(-2);
  });

  it("los objetivos de sede no se mezclan con los del comercial", () => {
    const [sede] = construirSeguimiento({
      ambito: "sede",
      sujetos: [{ id: "t1", nombre: "Centro" }],
      objetivos,
      ventas,
      concepto: CONCEPTO_TOTAL,
      progreso,
      articuloIds: ["art_fibra", "art_pospago"],
      catalogo,
    });
    expect(sede.objetivo).toBe(62);
    expect(sede.vendido).toBe(8);
  });

  it("un grupo de productos solo mide lo suyo", () => {
    const concepto = normalizarConcepto(columnaSubgrupo(HOGAR), catalogo, [HOGAR]);
    const [ana] = construirSeguimiento({
      ambito: "comercial",
      sujetos: [{ id: "u_ana", nombre: "Ana García", sede: "Centro" }],
      objetivos: [
        {
          id: "o3",
          mes: "2026-07",
          userId: "u_ana",
          tiendaId: null,
          articuloId: null,
          ...HOGAR,
          cantidad: 62,
        },
      ],
      ventas,
      concepto,
      progreso,
      articuloIds: ["art_fibra", "art_pospago"],
      catalogo,
    });
    expect(concepto.tipo).toBe("grupo");
    expect(ana.objetivo).toBe(62);
    expect(ana.vendido).toBe(8);
  });

  it("un concepto que ya no existe cae en unidades totales", () => {
    expect(normalizarConcepto("art_borrado", catalogo, [HOGAR]).tipo).toBe("total");
    expect(
      normalizarConcepto(columnaSubgrupo({ subcategoria: "Fantasma" }), catalogo, [HOGAR]).tipo,
    ).toBe("total");
  });

  it("el pie de la tabla suma objetivos y cuenta quién llega", () => {
    const filas = construirSeguimiento({
      ambito: "comercial",
      sujetos: [
        { id: "u_ana", nombre: "Ana García", sede: "Centro" },
        { id: "u_sin", nombre: "Sin objetivo", sede: "Centro" },
      ],
      objetivos,
      ventas,
      concepto: CONCEPTO_TOTAL,
      progreso,
      articuloIds: ["art_fibra", "art_pospago"],
      catalogo,
    });
    const t = totalesSeguimiento(filas, progreso);
    expect(t.objetivo).toBe(31);
    expect(t.conObjetivo).toBe(1);
    expect(t.cumplen).toBe(0);
    expect(t.vendido).toBe(8);
  });

  it("sin nadie con objetivo, el total no es cero: es 'sin objetivo'", () => {
    const filas = construirSeguimiento({
      ambito: "comercial",
      sujetos: [{ id: "u_sin", nombre: "Sin objetivo", sede: "Centro" }],
      objetivos: [],
      ventas: [],
      concepto: CONCEPTO_TOTAL,
      progreso,
      articuloIds: [],
      catalogo,
    });
    expect(totalesSeguimiento(filas, progreso).objetivo).toBeNull();
  });
});

describe("día a día", () => {
  const progreso = progresoDelMes("2026-07", "2026-07-03");

  it("pinta todos los días transcurridos, también los de cero ventas", () => {
    const serie = serieDiaria({
      ventas: [venta("2026-07-01", "art_fibra", 4), venta("2026-07-03", "art_pospago", 2)],
      concepto: CONCEPTO_TOTAL,
      objetivo: 31,
      progreso,
    });
    expect(serie.map((p) => p.fecha)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
    expect(serie.map((p) => p.vendido)).toEqual([4, 0, 2]);
    expect(serie.map((p) => p.acumulado)).toEqual([4, 4, 6]);
    // Reparto lineal: 1, 2 y 3 unidades acumuladas de objetivo.
    expect(serie.map((p) => p.objetivoAcumulado)).toEqual([1, 2, 3]);
    expect(serie[2].desviacion).toBe(3);
  });

  it("un mes que no ha empezado no tiene días", () => {
    const futuro = progresoDelMes("2026-09", "2026-09-01");
    expect(serieDiaria({ ventas: [], concepto: CONCEPTO_TOTAL, objetivo: 10, progreso: { ...futuro, transcurridos: 0 } })).toEqual([]);
  });
});
