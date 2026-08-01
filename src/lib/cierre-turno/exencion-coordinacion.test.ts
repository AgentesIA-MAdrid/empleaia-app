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

  it("un comercial en TIENDA nunca está exento", () => {
    // Ojo: en la oficina sí lo está desde el ticket 9d4e17c2 — allí no hay caja
    // ni stock. Lo que no cambia es que en una tienda hace sus controles.
    expect(
      exentoDeControlesDeTienda({ rol: "EMPLEADO", turnosDelDia: [{ esOficina: false }] }),
    ).toBe(false);
    expect(exentoDeControlesDeTienda({ rol: "EMPLEADO", turnosDelDia: [] })).toBe(false);
  });

  it("administración tampoco entra por aquí", () => {
    expect(exentoDeControlesDeTienda({ rol: "OWNER", turnosDelDia: [] })).toBe(false);
  });
});

describe("la oficina exime a cualquiera (ticket 9d4e17c2)", () => {
  it("un comercial con turno en la oficina no firma checks ni cierra caja", () => {
    // Antes esto solo valía para el coordinador, y dejaba a la gente de
    // administración firmando que había revisado una tienda donde no estaba.
    expect(
      exentoDeControlesDeTienda({ rol: "EMPLEADO", turnosDelDia: [{ esOficina: true }] }),
    ).toBe(true);
  });

  it("y en una tienda sigue haciéndolos", () => {
    expect(
      exentoDeControlesDeTienda({ rol: "EMPLEADO", turnosDelDia: [{ esOficina: false }] }),
    ).toBe(false);
  });

  it("jornada partida entre oficina y tienda: manda la tienda, para todos", () => {
    expect(
      exentoDeControlesDeTienda({
        rol: "EMPLEADO",
        turnosDelDia: [{ esOficina: true }, { esOficina: false }],
      }),
    ).toBe(false);
  });

  it("un comercial SIN turno no queda exento: si ficha, está en una tienda", () => {
    expect(exentoDeControlesDeTienda({ rol: "EMPLEADO", turnosDelDia: [] })).toBe(false);
    // El coordinador sí: su sitio por defecto es la oficina.
    expect(exentoDeControlesDeTienda({ rol: "MANAGER", turnosDelDia: [] })).toBe(true);
  });
});
