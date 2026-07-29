import { describe, it, expect } from "vitest";
import {
  alcanceSegunRol,
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
