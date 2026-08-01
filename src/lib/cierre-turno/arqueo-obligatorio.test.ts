import { describe, it, expect } from "vitest";
import { esDiaDeArqueo, esElUltimoEnSalir, tocaArqueo } from "./arqueo-obligatorio";

const DOMINGO = new Date("2026-08-02T00:00:00Z");
const SABADO = new Date("2026-08-01T00:00:00Z");

const TURNOS = [
  { userId: "u_mañana", horaFin: "15:00" },
  { userId: "u_tarde", horaFin: "22:00" },
];

describe("esDiaDeArqueo — ticket 2c9d84f1", () => {
  it("sin dato de la sede se asume domingo, como antes", () => {
    expect(esDiaDeArqueo(DOMINGO)).toBe(true);
    expect(esDiaDeArqueo(SABADO)).toBe(false);
    expect(esDiaDeArqueo(new Date("2026-08-03T00:00:00Z"))).toBe(false); // lunes
  });

  it("una tienda que cierra el sábado arquea el sábado", () => {
    expect(esDiaDeArqueo(SABADO, 6)).toBe(true);
    expect(esDiaDeArqueo(DOMINGO, 6)).toBe(false);
  });

  it("un valor imposible cae al domingo en vez de no arquear nunca", () => {
    // Un 0, un 9 o un null tendrían a la tienda sin arquear para siempre.
    expect(esDiaDeArqueo(DOMINGO, 0)).toBe(true);
    expect(esDiaDeArqueo(DOMINGO, 9)).toBe(true);
    expect(esDiaDeArqueo(DOMINGO, null)).toBe(true);
  });
});

describe("esElUltimoEnSalir — ticket 3b7e05d1", () => {
  it("el de la tarde sí, el de la mañana no", () => {
    expect(esElUltimoEnSalir({ userId: "u_tarde", turnosDeLaSede: TURNOS })).toBe(true);
    expect(esElUltimoEnSalir({ userId: "u_mañana", turnosDeLaSede: TURNOS })).toBe(false);
  });

  it("con el cuadrante vacío le toca a quien esté cerrando", () => {
    // Pasa: el turno no se metió o se metió mal. Mejor que sobre una
    // comprobación a que el domingo se quede sin arquear.
    expect(esElUltimoEnSalir({ userId: "u_x", turnosDeLaSede: [] })).toBe(true);
  });

  it("un correturnos sin turno propio también cierra la tienda", () => {
    expect(esElUltimoEnSalir({ userId: "u_cubre", turnosDeLaSede: TURNOS })).toBe(true);
  });

  it("empatar a hora cuenta como ser el último", () => {
    const empate = [
      { userId: "u_a", horaFin: "22:00" },
      { userId: "u_b", horaFin: "22:00" },
    ];
    expect(esElUltimoEnSalir({ userId: "u_a", turnosDeLaSede: empate })).toBe(true);
    expect(esElUltimoEnSalir({ userId: "u_b", turnosDeLaSede: empate })).toBe(true);
  });

  it("una hora ilegible se trata como el final del día, no como las 00:00", () => {
    // Si no, un turno con la hora mal escrita convertiría a cualquiera en "el
    // último" y se pediría el arqueo a quien sale a mediodía.
    const roto = [
      { userId: "u_roto", horaFin: "" },
      { userId: "u_tarde", horaFin: "22:00" },
    ];
    expect(esElUltimoEnSalir({ userId: "u_tarde", turnosDeLaSede: roto })).toBe(false);
  });
});

describe("tocaArqueo", () => {
  const base = {
    fecha: DOMINGO,
    userId: "u_tarde",
    turnosDeLaSede: TURNOS,
    arqueoYaDeclarado: false,
    sedeSinCaja: false,
  };

  it("domingo, último turno y sin declarar: le toca", () => {
    expect(tocaArqueo(base)).toBe(true);
  });

  it("cualquier otro día, no", () => {
    expect(tocaArqueo({ ...base, fecha: SABADO })).toBe(false);
  });

  it("si un compañero ya lo declaró, no se pide otra vez", () => {
    expect(tocaArqueo({ ...base, arqueoYaDeclarado: true })).toBe(false);
  });

  it("al de la mañana no le toca aunque sea domingo", () => {
    expect(tocaArqueo({ ...base, userId: "u_mañana" })).toBe(false);
  });

  it("en una sede sin caja nuestra no hay nada que arquear", () => {
    // Un córner que liquida el centro, o la oficina.
    expect(tocaArqueo({ ...base, sedeSinCaja: true })).toBe(false);
  });
});

/**
 * El aviso de "tu tienda sigue sin arquear" (misma regla, otra lectura): es
 * domingo, nadie ha declarado y a esta persona no le sale el paso porque el
 * cuadrante dice que sale otro después. Si el cuadrante está mal, el domingo se
 * quedaría sin arquear sin que nadie se entere.
 */
describe("cuándo hay que avisar de que la tienda sigue sin arquear", () => {
  const pendienteEnSede = (args: {
    fecha: Date;
    userId: string;
    turnosDeLaSede: { userId: string; horaFin: string }[];
    arqueoYaDeclarado: boolean;
    sedeSinCaja: boolean;
    arqueoDiaSemana?: number | null;
  }) =>
    !tocaArqueo(args) &&
    !args.sedeSinCaja &&
    !args.arqueoYaDeclarado &&
    esDiaDeArqueo(args.fecha, args.arqueoDiaSemana);

  const base = {
    fecha: DOMINGO,
    userId: "u_mañana",
    turnosDeLaSede: TURNOS,
    arqueoYaDeclarado: false,
    sedeSinCaja: false,
  };

  it("al de la mañana se le avisa: puede que sea él quien cierre de verdad", () => {
    expect(pendienteEnSede(base)).toBe(true);
  });

  it("a quien le toca hacerlo no se le avisa: ya tiene el paso", () => {
    expect(pendienteEnSede({ ...base, userId: "u_tarde" })).toBe(false);
  });

  it("declarado por un compañero: nada que avisar", () => {
    expect(pendienteEnSede({ ...base, arqueoYaDeclarado: true })).toBe(false);
  });

  it("entre semana no se avisa de nada", () => {
    expect(pendienteEnSede({ ...base, fecha: SABADO })).toBe(false);
  });

  it("en una sede sin caja nuestra, tampoco", () => {
    expect(pendienteEnSede({ ...base, sedeSinCaja: true })).toBe(false);
  });
});

/**
 * El día de arqueo depende de la tienda (ticket 2c9d84f1): las de centro
 * comercial abren el domingo y arquean ese día; las de calle cierran el sábado
 * y arquean entonces, porque el domingo no hay nadie que cuente el dinero.
 */
describe("tocaArqueo — tiendas que no abren el domingo", () => {
  const base = {
    userId: "u_tarde",
    turnosDeLaSede: TURNOS,
    arqueoYaDeclarado: false,
    sedeSinCaja: false,
  };

  it("una tienda de calle arquea el SÁBADO, no el domingo", () => {
    expect(tocaArqueo({ ...base, fecha: SABADO, arqueoDiaSemana: 6 })).toBe(true);
    // Y el domingo no se le pide a nadie: la tienda está cerrada.
    expect(tocaArqueo({ ...base, fecha: DOMINGO, arqueoDiaSemana: 6 })).toBe(false);
  });

  it("una tienda de centro comercial sigue arqueando el domingo", () => {
    expect(tocaArqueo({ ...base, fecha: DOMINGO, arqueoDiaSemana: 7 })).toBe(true);
    expect(tocaArqueo({ ...base, fecha: SABADO, arqueoDiaSemana: 7 })).toBe(false);
  });

  it("el sábado de una tienda de domingo no dispara nada", () => {
    // Antes de esto, el sábado no era día de arqueo para nadie: que siga así
    // donde no toca.
    expect(tocaArqueo({ ...base, fecha: SABADO })).toBe(false);
  });

  it("al que no cierra la tienda tampoco se le pide, sea el día que sea", () => {
    expect(tocaArqueo({ ...base, fecha: SABADO, userId: "u_mañana", arqueoDiaSemana: 6 })).toBe(
      false,
    );
  });
});
