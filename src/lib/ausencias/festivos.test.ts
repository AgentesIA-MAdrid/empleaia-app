import { describe, it, expect } from "vitest";
import { festivoAplicaA } from "@/lib/ausencias/festivos";

describe("festivoAplicaA", () => {
  const empleadoSedeA = { id: "u1", tiendaId: "sedeA" };
  const empleadoSedeB = { id: "u2", tiendaId: "sedeB" };
  const empleadoSinSede = { id: "u3", tiendaId: null };

  it("festivo nacional aplica a toda la plantilla", () => {
    const fest = { ambito: "nacional", tiendaId: null, excepciones: [] };
    expect(festivoAplicaA(fest, empleadoSedeA)).toBe(true);
    expect(festivoAplicaA(fest, empleadoSinSede)).toBe(true);
  });

  it("festivo local solo aplica a empleados de su sede", () => {
    const fest = { ambito: "local", tiendaId: "sedeA", excepciones: [] };
    expect(festivoAplicaA(fest, empleadoSedeA)).toBe(true);
    expect(festivoAplicaA(fest, empleadoSedeB)).toBe(false);
    expect(festivoAplicaA(fest, empleadoSinSede)).toBe(false);
  });

  it("una excepción quita el festivo a ese empleado (trabaja ese día)", () => {
    const fest = {
      ambito: "nacional",
      tiendaId: null,
      excepciones: [{ userId: "u1" }],
    };
    expect(festivoAplicaA(fest, empleadoSedeA)).toBe(false);
    expect(festivoAplicaA(fest, empleadoSedeB)).toBe(true);
  });

  it("la excepción manda incluso en festivos locales", () => {
    const fest = {
      ambito: "local",
      tiendaId: "sedeA",
      excepciones: [{ userId: "u1" }],
    };
    expect(festivoAplicaA(fest, empleadoSedeA)).toBe(false);
  });
});
