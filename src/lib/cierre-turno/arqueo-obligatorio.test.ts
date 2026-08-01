import { describe, it, expect } from "vitest";
import { esElUltimoEnSalir, esUltimoDiaDeLaSemana, tocaArqueo } from "./arqueo-obligatorio";

const DOMINGO = new Date("2026-08-02T00:00:00Z");
const SABADO = new Date("2026-08-01T00:00:00Z");

const TURNOS = [
  { userId: "u_mañana", horaFin: "15:00" },
  { userId: "u_tarde", horaFin: "22:00" },
];

describe("esUltimoDiaDeLaSemana", () => {
  it("el domingo sí; el resto no", () => {
    expect(esUltimoDiaDeLaSemana(DOMINGO)).toBe(true);
    expect(esUltimoDiaDeLaSemana(SABADO)).toBe(false);
    expect(esUltimoDiaDeLaSemana(new Date("2026-08-03T00:00:00Z"))).toBe(false); // lunes
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
