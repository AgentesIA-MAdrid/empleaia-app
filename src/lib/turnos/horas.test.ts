import { describe, it, expect } from "vitest";
import { horasDeRango, horasDeTurno, etiquetaTurno } from "./horas";

describe("horasDeRango", () => {
  it("calcula un turno de mañana", () => {
    expect(horasDeRango("09:00", "15:00")).toBe(6);
  });
  it("admite medias horas", () => {
    expect(horasDeRango("09:00", "16:30")).toBe(7.5);
  });
  it("cruza medianoche sumando 24h", () => {
    expect(horasDeRango("22:00", "06:00")).toBe(8);
  });
  it("devuelve 0 con datos vacíos o inválidos", () => {
    expect(horasDeRango("", "15:00")).toBe(0);
    expect(horasDeRango(null, null)).toBe(0);
    expect(horasDeRango("aa:bb", "15:00")).toBe(0);
  });
});

describe("horasDeTurno", () => {
  it("usa las horas del tipo cuando están definidas", () => {
    expect(horasDeTurno({ tipoTurno: { horas: 12 } })).toBe(12);
  });
  it("acepta horas del tipo como string (Decimal serializado)", () => {
    expect(horasDeTurno({ tipoTurno: { horas: "7" } })).toBe(7);
  });
  it("un tipo LIBRE computa 0 aunque traiga horas", () => {
    expect(horasDeTurno({ tipoTurno: { esLibre: true, horas: 5 } })).toBe(0);
  });
  it("cae al rango si el tipo no define horas", () => {
    expect(
      horasDeTurno({ tipoTurno: { horas: 0 }, horaInicio: "09:00", horaFin: "13:00" }),
    ).toBe(4);
  });
  it("deriva del rango sin tipo", () => {
    expect(horasDeTurno({ horaInicio: "16:00", horaFin: "21:00" })).toBe(5);
  });
});

describe("etiquetaTurno", () => {
  it("prefiere la abreviatura del tipo", () => {
    expect(etiquetaTurno({ tipoTurno: { abreviatura: "M", nombre: "Mañana" } })).toBe("M");
  });
  it("cae al nombre si no hay abreviatura", () => {
    expect(etiquetaTurno({ tipoTurno: { abreviatura: "", nombre: "Doble" } })).toBe("Doble");
  });
  it("muestra el rango si no hay tipo", () => {
    expect(etiquetaTurno({ horaInicio: "16:00", horaFin: "21:00" })).toBe("16:00–21:00");
  });
});
