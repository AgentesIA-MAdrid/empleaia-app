import { describe, it, expect } from "vitest";
import { diasLaborables } from "./rellenar-oficina";

describe("diasLaborables", () => {
  // Semana del lunes 2026-07-20 al domingo 2026-07-26.
  const semana = [
    "2026-07-20", // lunes
    "2026-07-21", // martes
    "2026-07-22", // miércoles
    "2026-07-23", // jueves
    "2026-07-24", // viernes
    "2026-07-25", // sábado
    "2026-07-26", // domingo
  ];

  it("descarta sábado y domingo", () => {
    expect(diasLaborables(semana)).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
    ]);
  });

  it("devuelve lista vacía si solo hay fin de semana", () => {
    expect(diasLaborables(["2026-07-25", "2026-07-26"])).toEqual([]);
  });

  it("conserva el orden de entrada", () => {
    expect(diasLaborables(["2026-07-22", "2026-07-20"])).toEqual([
      "2026-07-22",
      "2026-07-20",
    ]);
  });
});
