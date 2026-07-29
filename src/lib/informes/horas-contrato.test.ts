import { describe, it, expect } from "vitest";
import {
  diasDelPeriodo,
  diferenciaContrato,
  horasContratoPeriodo,
  horasSemanalesDe,
} from "./horas-contrato";

describe("horasSemanalesDe", () => {
  it("prioriza el contrato de la persona", () => {
    expect(horasSemanalesDe(20, 40)).toBe(20);
  });

  it("acepta Decimal de Prisma (llega como objeto con toString)", () => {
    expect(horasSemanalesDe({ toString: () => "37.5" }, 40)).toBe(37.5);
  });

  it("cae a la jornada de la empresa si la persona no tiene contrato", () => {
    expect(horasSemanalesDe(null, 38)).toBe(38);
    expect(horasSemanalesDe("", 38)).toBe(38);
  });

  it("cae a 40 si no hay ni contrato ni configuración", () => {
    expect(horasSemanalesDe(null, null)).toBe(40);
  });

  it("respeta un contrato de 0 horas", () => {
    expect(horasSemanalesDe(0, 40)).toBe(0);
  });
});

describe("diasDelPeriodo", () => {
  // Las fechas llegan como ISO UTC con el fin a final del día: una semana
  // debe dar 7 y un mes de 31 días, 31 (aunque el servidor esté en otro huso).
  it("cuenta una semana completa como 7 días", () => {
    expect(
      diasDelPeriodo(
        new Date("2026-07-06T00:00:00Z"),
        new Date("2026-07-12T23:59:59Z"),
      ),
    ).toBe(7);
  });

  it("cuenta un mes de 31 días como 31", () => {
    expect(
      diasDelPeriodo(
        new Date("2026-07-01T00:00:00Z"),
        new Date("2026-07-31T23:59:59Z"),
      ),
    ).toBe(31);
  });

  it("un solo día cuenta 1", () => {
    expect(
      diasDelPeriodo(
        new Date("2026-07-01T00:00:00Z"),
        new Date("2026-07-01T23:59:59Z"),
      ),
    ).toBe(1);
  });

  it("tolera desfases de huso (semana pedida en hora local de Madrid)", () => {
    // Lunes 00:00 y domingo 23:59:59 en UTC+2 = 22:00Z del día anterior.
    expect(
      diasDelPeriodo(
        new Date("2026-07-05T22:00:00Z"),
        new Date("2026-07-12T21:59:59Z"),
      ),
    ).toBe(7);
  });
});

describe("horasContratoPeriodo / diferenciaContrato", () => {
  it("prorratea el contrato semanal a los días del periodo", () => {
    expect(horasContratoPeriodo(40, 7)).toBe(40);
    expect(horasContratoPeriodo(40, 30)).toBe(171.43);
    expect(horasContratoPeriodo(20, 14)).toBe(40);
  });

  it("la diferencia es positiva cuando se supera el contrato", () => {
    expect(diferenciaContrato(45, 40)).toBe(5);
    expect(diferenciaContrato(32.5, 40)).toBe(-7.5);
  });
});
