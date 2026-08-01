import { describe, it, expect } from "vitest";
import { codigoDeSede } from "./banco";

/**
 * El fichero del operador identifica la tienda con su propio código. Se casa por
 * ahí y no por el nombre (ticket 4b8e1d05): su "NEKSUS MAJADAHONDA CC GRAN PZA"
 * es nuestra "NEKSUS CC GRAN PLAZA 2", y emparejar eso a ojo acabaría metiendo
 * el dinero de una tienda en otra.
 */
describe("codigoDeSede", () => {
  it("saca el código del formato del operador", () => {
    expect(codigoDeSede("MY128022 - NEKSUS MADRID CC PLENILUNIO")).toBe("MY128022");
    expect(codigoDeSede("MEC10011 - NEKSUS MADRID EL CORTE INGLES POZUELO")).toBe("MEC10011");
    expect(codigoDeSede("LY128029 - CC LA VAGUADA")).toBe("LY128029");
  });

  it("aguanta espacios de más y el guion largo", () => {
    expect(codigoDeSede("  MY128054   –   NEKSUS MADRID - CC ISLA AZUL  ")).toBe("MY128054");
  });

  it("un nombre con guion detrás no confunde", () => {
    // "NEKSUS MADRID - CC ISLA AZUL" tiene su propio guion: el código es el
    // primero, no lo que hay tras el segundo.
    expect(codigoDeSede("MY128054 - NEKSUS MADRID - CC ISLA AZUL")).toBe("MY128054");
  });

  it("sin guion, vale si la primera palabra es claramente un código", () => {
    expect(codigoDeSede("MY128983 NEKSUS PARLA CC EL FERIAL")).toBe("MY128983");
  });

  it("un nombre suelto no es un código: mejor sin sede que en la equivocada", () => {
    expect(codigoDeSede("NEKSUS PLENILUNIO")).toBeNull();
    expect(codigoDeSede("Cuota IVA")).toBeNull();
    expect(codigoDeSede("")).toBeNull();
    expect(codigoDeSede(null)).toBeNull();
  });
});
