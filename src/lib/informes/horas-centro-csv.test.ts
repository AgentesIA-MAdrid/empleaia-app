import { describe, it, expect } from "vitest";
import { generarCSVHorasPorCentro } from "./horas-centro-csv";

describe("generarCSVHorasPorCentro", () => {
  it("escribe cabecera, BOM y decimales con coma", () => {
    const csv = generarCSVHorasPorCentro([
      { empleado: "Ana X", centro: "Sede A", horas: 12.5 },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lineas = csv.replace("﻿", "").split("\r\n");
    expect(lineas[0]).toBe("Empleado,Centro,Horas");
    // Las horas van entrecomilladas: si no, la coma decimal partiría la
    // fila en dos columnas al abrirla en Excel.
    expect(lineas[1]).toBe('"Ana X","Sede A","12,5"');
  });

  it("añade contrato y diferencia cuando las filas los traen", () => {
    const csv = generarCSVHorasPorCentro([
      { empleado: "Ana X", centro: "Sede A", horas: 20, horasTotales: 45, horasContrato: 40, diferencia: 5 },
      { empleado: "Ana X", centro: "Sede B", horas: 25, horasTotales: 45, horasContrato: 40, diferencia: -5.5 },
    ]);
    const lineas = csv.replace("﻿", "").split("\r\n");
    expect(lineas[0]).toBe(
      "Empleado,Centro,Horas,Horas totales del empleado,Horas de contrato,Diferencia",
    );
    expect(lineas[1]).toBe('"Ana X","Sede A","20","45","40","5"');
    // La diferencia negativa mantiene el signo y la coma decimal.
    expect(lineas[2]).toBe('"Ana X","Sede B","25","45","40","-5,5"');
  });

  it("escapa las comillas de los textos", () => {
    const csv = generarCSVHorasPorCentro([
      { empleado: 'Ana "La jefa"', centro: "Sede, A", horas: 1 },
    ]);
    expect(csv).toContain('"Ana ""La jefa""","Sede, A","1"');
  });
});
