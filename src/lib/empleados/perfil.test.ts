import { describe, it, expect } from "vitest";
import {
  CAMPOS_OBLIGATORIOS,
  esPerfilCompleto,
  camposPerfilFaltantes,
} from "./perfil";

/** Construye un objeto con todos los campos obligatorios rellenos. */
function perfilCompletoFixture(): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const c of CAMPOS_OBLIGATORIOS) o[c] = "valor";
  return o;
}

describe("esPerfilCompleto", () => {
  it("false para null/undefined", () => {
    expect(esPerfilCompleto(null)).toBe(false);
    expect(esPerfilCompleto(undefined)).toBe(false);
  });

  it("false si falta cualquier campo obligatorio", () => {
    const base = perfilCompletoFixture();
    for (const c of CAMPOS_OBLIGATORIOS) {
      const copia = { ...base, [c]: null };
      expect(esPerfilCompleto(copia), `debería faltar ${c}`).toBe(false);
    }
  });

  it("false si un campo es cadena vacía o solo espacios", () => {
    const base = perfilCompletoFixture();
    expect(esPerfilCompleto({ ...base, dni: "" })).toBe(false);
    expect(esPerfilCompleto({ ...base, dni: "   " })).toBe(false);
  });

  it("true cuando todos los obligatorios están rellenos", () => {
    expect(esPerfilCompleto(perfilCompletoFixture())).toBe(true);
  });

  it("acepta valores no-string (p.ej. fecha) como rellenos", () => {
    const base = perfilCompletoFixture();
    expect(esPerfilCompleto({ ...base, fechaNacimiento: new Date() })).toBe(true);
  });
});

describe("camposPerfilFaltantes", () => {
  it("devuelve todos los obligatorios si no hay datos", () => {
    expect(camposPerfilFaltantes(null)).toEqual([...CAMPOS_OBLIGATORIOS]);
  });

  it("devuelve solo los que faltan", () => {
    const base = perfilCompletoFixture();
    const faltan = camposPerfilFaltantes({ ...base, dni: null, localidad: "" });
    expect(faltan.sort()).toEqual(["dni", "localidad"].sort());
  });

  it("vacío cuando el perfil está completo", () => {
    expect(camposPerfilFaltantes(perfilCompletoFixture())).toEqual([]);
  });
});
