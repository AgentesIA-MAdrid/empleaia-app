import { describe, it, expect } from "vitest";
import { moduloCierreVisibleEnMenu } from "./visibilidad";

describe("moduloCierreVisibleEnMenu", () => {
  it("sin el módulo contratado, nadie lo ve", () => {
    for (const rol of ["OWNER", "MANAGER", "EMPLEADO"]) {
      expect(moduloCierreVisibleEnMenu({ rol, bloqueada: true, enRodaje: false })).toBe(false);
      expect(moduloCierreVisibleEnMenu({ rol, bloqueada: true, enRodaje: true })).toBe(false);
    }
  });

  it("en rodaje, solo administración", () => {
    expect(moduloCierreVisibleEnMenu({ rol: "OWNER", bloqueada: false, enRodaje: true })).toBe(true);
    expect(moduloCierreVisibleEnMenu({ rol: "MANAGER", bloqueada: false, enRodaje: true })).toBe(false);
    expect(moduloCierreVisibleEnMenu({ rol: "EMPLEADO", bloqueada: false, enRodaje: true })).toBe(false);
  });

  it("abierto, lo ve todo el mundo", () => {
    for (const rol of ["OWNER", "MANAGER", "EMPLEADO"]) {
      expect(moduloCierreVisibleEnMenu({ rol, bloqueada: false, enRodaje: false })).toBe(true);
    }
  });

  it("el rodaje no resucita un módulo no contratado", () => {
    // Si algún día se invierte el orden de las comprobaciones, un cliente sin
    // el módulo vería el menú por ser OWNER. Este test lo fija.
    expect(moduloCierreVisibleEnMenu({ rol: "OWNER", bloqueada: true, enRodaje: true })).toBe(false);
  });
});
