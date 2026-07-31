import { describe, it, expect } from "vitest";
import { exentoDeControlesDeTienda } from "./exencion-coordinacion";

describe("exentoDeControlesDeTienda — ticket 73", () => {
  it("la coordinadora con turno en oficina no firma checks ni cierra caja", () => {
    expect(
      exentoDeControlesDeTienda({ rol: "MANAGER", turnosDelDia: [{ esOficina: true }] }),
    ).toBe(true);
  });

  it("el día que cubre en un punto de venta, hace los controles como el resto", () => {
    expect(
      exentoDeControlesDeTienda({ rol: "MANAGER", turnosDelDia: [{ esOficina: false }] }),
    ).toBe(false);
  });

  it("jornada partida entre oficina y tienda: manda la tienda", () => {
    expect(
      exentoDeControlesDeTienda({
        rol: "MANAGER",
        turnosDelDia: [{ esOficina: true }, { esOficina: false }],
      }),
    ).toBe(false);
  });

  it("sin turno ese día queda exenta: no hay cuadrante que la ponga en tienda", () => {
    expect(exentoDeControlesDeTienda({ rol: "MANAGER", turnosDelDia: [] })).toBe(true);
  });

  it("un comercial nunca está exento, ni siquiera fichando en la oficina", () => {
    expect(
      exentoDeControlesDeTienda({ rol: "EMPLEADO", turnosDelDia: [{ esOficina: true }] }),
    ).toBe(false);
    expect(exentoDeControlesDeTienda({ rol: "EMPLEADO", turnosDelDia: [] })).toBe(false);
  });

  it("administración tampoco entra por aquí", () => {
    expect(exentoDeControlesDeTienda({ rol: "OWNER", turnosDelDia: [] })).toBe(false);
  });
});
