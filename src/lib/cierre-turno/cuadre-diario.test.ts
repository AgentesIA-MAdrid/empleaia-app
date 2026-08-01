import { describe, it, expect } from "vitest";
import { cuadrePorDia, libroDeCaja, sumarDias } from "./cuadre-diario";

describe("libroDeCaja — ticket 1e73c9a4", () => {
  it("entra el efectivo de cada cierre y sale lo que retiran, con su saldo", () => {
    const { movimientos, saldoFinal } = libroDeCaja({
      saldos: [{ fecha: "2026-07-31", importe: 239.32, nota: "Carga inicial" }],
      entradas: [
        { fecha: "2026-08-01", importe: 120, quien: "Ana Ruiz" },
        { fecha: "2026-08-02", importe: 80.5, quien: "Luis Gil" },
      ],
      salidas: [
        { fecha: "2026-08-02", importe: 439.82, quien: "Jose Ramón", semana: "2026-W31" },
      ],
    });
    expect(movimientos.map((m) => [m.tipo, m.importe, m.saldo])).toEqual([
      ["saldo", 239.32, 239.32],
      ["entrada", 120, 359.32],
      ["entrada", 80.5, 439.82],
      ["salida", 439.82, 0],
    ]);
    expect(saldoFinal).toBe(0);
  });

  it("dentro del mismo día: primero el saldo, luego lo cobrado, al final la retirada", () => {
    // Es el orden real: se cuenta el cajón, se cobra durante el día y al cerrar
    // se saca el sobre. Ordenarlo de otra forma daría saldos negativos falsos.
    const { movimientos } = libroDeCaja({
      saldos: [{ fecha: "2026-08-01", importe: 0 }],
      entradas: [{ fecha: "2026-08-01", importe: 50, quien: "Ana" }],
      salidas: [{ fecha: "2026-08-01", importe: 50, quien: "Jefe" }],
    });
    expect(movimientos.map((m) => m.tipo)).toEqual(["saldo", "entrada", "salida"]);
    expect(movimientos.at(-1)?.saldo).toBe(0);
  });

  it("un saldo fijado NO suma: reemplaza el acumulado", () => {
    // El arqueo deja la caja a cero; si el cero se sumara, el saldo se quedaría
    // con el dinero que ya está en el sobre.
    const { saldoFinal } = libroDeCaja({
      saldos: [
        { fecha: "2026-07-31", importe: 500 },
        { fecha: "2026-08-02", importe: 0, nota: "Arqueo de la semana: pasa al sobre" },
      ],
      entradas: [{ fecha: "2026-08-01", importe: 120, quien: "Ana" }],
      salidas: [],
    });
    expect(saldoFinal).toBe(0);
  });

  it("una caja en incidencia no fija ningún saldo", () => {
    // Se cargó sin importe porque no se sabía cuánto había: no puede mandar.
    const { movimientos, saldoFinal } = libroDeCaja({
      saldos: [{ fecha: "2026-07-31", importe: null, nota: "Pendiente de aclarar" }],
      entradas: [{ fecha: "2026-08-01", importe: 40, quien: "Ana" }],
      salidas: [],
    });
    expect(movimientos).toHaveLength(1);
    expect(saldoFinal).toBe(40);
  });

  it("los céntimos no se van sumando solos", () => {
    const { saldoFinal } = libroDeCaja({
      saldos: [],
      entradas: [
        { fecha: "2026-08-01", importe: 0.1, quien: null },
        { fecha: "2026-08-01", importe: 0.2, quien: null },
      ],
      salidas: [],
    });
    expect(saldoFinal).toBe(0.3);
  });

  it("sin nada que enseñar devuelve una lista vacía, no un error", () => {
    expect(libroDeCaja({ saldos: [], entradas: [], salidas: [] })).toEqual({
      movimientos: [],
      saldoFinal: 0,
    });
  });
});

describe("cuadreTarjeta — el desfase del banco", () => {
  it("lo cobrado el 1 se compara con el ingreso del 2", () => {
    const filas = cuadrePorDia({
      declaradoPorDia: new Map([["2026-08-01", 1210]]),
      bancoPorDia: new Map([["2026-08-02", { importe: 1210, movimientos: 1 }]]),
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      fecha: "2026-08-01",
      fechaBanco: "2026-08-02",
      declarado: 1210,
      banco: 1210,
      diferencia: 0,
      descuadre: false,
    });
  });

  it("sin desfase, ese mismo caso daría dos descuadres falsos", () => {
    // Es lo que pasaba comparando el mismo día: un día con ventas y sin ingreso,
    // y otro con ingreso y sin ventas.
    const filas = cuadrePorDia({
      declaradoPorDia: new Map([["2026-08-01", 1210]]),
      bancoPorDia: new Map([["2026-08-02", { importe: 1210, movimientos: 1 }]]),
      desfaseDias: 0,
    });
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.descuadre)).toBe(true);
  });

  it("una diferencia real se marca, y el signo dice de qué lado", () => {
    const filas = cuadrePorDia({
      declaradoPorDia: new Map([["2026-08-01", 1000]]),
      bancoPorDia: new Map([["2026-08-02", { importe: 950, movimientos: 2 }]]),
    });
    // Ha entrado menos de lo declarado: negativo.
    expect(filas[0]?.diferencia).toBe(-50);
    expect(filas[0]?.descuadre).toBe(true);
    expect(filas[0]?.movimientos).toBe(2);
  });

  it("un ingreso sin ventas ese día también sale", () => {
    // Es justo lo que hay que mirar: dinero que entra sin venta detrás.
    const filas = cuadrePorDia({
      declaradoPorDia: new Map(),
      bancoPorDia: new Map([["2026-08-05", { importe: 300, movimientos: 1 }]]),
    });
    expect(filas).toEqual([
      expect.objectContaining({ fecha: "2026-08-04", fechaBanco: "2026-08-05", banco: 300 }),
    ]);
  });

  it("por debajo del umbral no se marca: son redondeos", () => {
    const filas = cuadrePorDia({
      declaradoPorDia: new Map([["2026-08-01", 1000]]),
      bancoPorDia: new Map([["2026-08-02", { importe: 999.5, movimientos: 1 }]]),
    });
    expect(filas[0]?.descuadre).toBe(false);
  });

  it("los días a cero por los dos lados no ensucian la tabla", () => {
    const filas = cuadrePorDia({
      declaradoPorDia: new Map([["2026-08-01", 0]]),
      bancoPorDia: new Map(),
    });
    expect(filas).toEqual([]);
  });

  it("salen ordenados por día de venta", () => {
    const filas = cuadrePorDia({
      declaradoPorDia: new Map([
        ["2026-08-03", 10],
        ["2026-08-01", 20],
      ]),
      bancoPorDia: new Map(),
    });
    expect(filas.map((f) => f.fecha)).toEqual(["2026-08-01", "2026-08-03"]);
  });
});

describe("sumarDias", () => {
  it("cruza meses y años sin despeinarse", () => {
    expect(sumarDias("2026-08-31", 1)).toBe("2026-09-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2026-01-01", -1)).toBe("2025-12-31");
  });
});
