import { describe, it, expect } from "vitest";
import {
  leerMovimientosBanco,
  MAPEO_BANCO_DEFECTO,
  normalizarMapeo,
  parsearFechaBanco,
  parsearImporteBanco,
  proponerMapeo,
  referenciaSintetica,
  type MapeoBanco,
} from "./banco";

describe("parsearFechaBanco", () => {
  it("día/mes/año, que es lo normal en un extracto español", () => {
    expect(parsearFechaBanco("30/07/2026")?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
    expect(parsearFechaBanco("30-07-2026")?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
    expect(parsearFechaBanco("30.07.2026")?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("respeta el formato configurado", () => {
    expect(parsearFechaBanco("07/30/2026", "mdy")?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
    expect(parsearFechaBanco("2026/07/30", "ymd")?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("entiende el ISO sin que le digan nada", () => {
    expect(parsearFechaBanco("2026-07-30")?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
    expect(parsearFechaBanco("2026-07-30T10:00:00Z")?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("acepta el Date que devuelve exceljs y lo lleva a medianoche UTC", () => {
    const d = new Date("2026-07-30T14:35:00Z");
    expect(parsearFechaBanco(d)?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("años de dos cifras", () => {
    expect(parsearFechaBanco("30/07/26")?.getUTCFullYear()).toBe(2026);
    expect(parsearFechaBanco("30/07/95")?.getUTCFullYear()).toBe(1995);
  });

  it("no inventa fechas imposibles", () => {
    expect(parsearFechaBanco("31/02/2026")).toBeNull();
    expect(parsearFechaBanco("30/13/2026")).toBeNull();
    expect(parsearFechaBanco("hola")).toBeNull();
    expect(parsearFechaBanco("")).toBeNull();
    expect(parsearFechaBanco(null)).toBeNull();
  });
});

describe("parsearImporteBanco", () => {
  it("formato español con miles y decimales", () => {
    expect(parsearImporteBanco("1.234,56")).toBe(1234.56);
    expect(parsearImporteBanco("1 234,56")).toBe(1234.56);
    expect(parsearImporteBanco("234,56 €")).toBe(234.56);
  });

  it("formato con punto decimal", () => {
    expect(parsearImporteBanco("1234.56")).toBe(1234.56);
    expect(parsearImporteBanco(1234.567)).toBe(1234.57);
  });

  it("puntos de miles sin decimales", () => {
    expect(parsearImporteBanco("1.234")).toBe(1234);
  });

  it("negativos con signo y con paréntesis", () => {
    expect(parsearImporteBanco("-50,00")).toBe(-50);
    expect(parsearImporteBanco("(50,00)")).toBe(-50);
  });

  it("descarta lo que no es importe", () => {
    expect(parsearImporteBanco("")).toBeNull();
    expect(parsearImporteBanco("varios")).toBeNull();
    expect(parsearImporteBanco("99999999999")).toBeNull();
  });
});

describe("proponerMapeo", () => {
  it("reconoce cabeceras habituales", () => {
    const { mapeo, reconocidas } = proponerMapeo([
      "Fecha operación",
      "Concepto",
      "Importe",
      "Referencia",
    ]);
    expect(mapeo.fecha).toBe(0);
    expect(mapeo.concepto).toBe(1);
    expect(mapeo.importe).toBe(2);
    expect(mapeo.referencia).toBe(3);
    expect(reconocidas).toEqual({ fecha: true, importe: true, concepto: true, referencia: true });
    expect(mapeo.conCabecera).toBe(true);
  });

  it("extracto con debe y haber: el haber es la columna de abonos", () => {
    const { mapeo } = proponerMapeo(["Fecha", "Concepto", "Importe", "Haber"]);
    expect(mapeo.importe).toBe(2);
    expect(mapeo.importeHaber).toBe(3);
  });

  it("sin cabeceras reconocibles avisa de que la primera fila es un movimiento", () => {
    const { mapeo, reconocidas } = proponerMapeo(["30/07/2026", "Liquidación TPV", "1.200,00"]);
    expect(mapeo.conCabecera).toBe(false);
    expect(reconocidas.fecha).toBe(false);
  });
});

describe("referenciaSintetica", () => {
  const base = { fecha: new Date("2026-07-30T00:00:00Z"), importe: 100, concepto: "TPV", tiendaId: "t1" };

  it("es estable: el mismo movimiento da la misma referencia", () => {
    expect(referenciaSintetica(base)).toBe(referenciaSintetica({ ...base }));
  });

  it("cambia si cambia cualquier dato del movimiento", () => {
    const r = referenciaSintetica(base);
    expect(referenciaSintetica({ ...base, importe: 101 })).not.toBe(r);
    expect(referenciaSintetica({ ...base, fecha: new Date("2026-07-31T00:00:00Z") })).not.toBe(r);
    expect(referenciaSintetica({ ...base, concepto: "Otro" })).not.toBe(r);
    expect(referenciaSintetica({ ...base, tiendaId: "t2" })).not.toBe(r);
  });
});

describe("leerMovimientosBanco", () => {
  const mapeo: MapeoBanco = { ...MAPEO_BANCO_DEFECTO, fecha: 0, concepto: 1, importe: 2 };

  it("lee los abonos y salta la cabecera", () => {
    const { movimientos, ignoradas } = leerMovimientosBanco(
      [
        ["Fecha", "Concepto", "Importe"],
        ["30/07/2026", "Liquidación TPV", "1.200,00"],
        ["31/07/2026", "Liquidación TPV", "950,50"],
      ],
      mapeo,
      "t1",
    );
    expect(movimientos).toHaveLength(2);
    expect(movimientos[0]?.importe).toBe(1200);
    expect(movimientos[0]?.fecha.toISOString()).toBe("2026-07-30T00:00:00.000Z");
    expect(movimientos[0]?.referenciaGenerada).toBe(true);
    expect(ignoradas).toHaveLength(0);
  });

  it("los cargos no entran: la caja de la tienda no tiene nada que ver con una comisión", () => {
    const { movimientos, ignoradas } = leerMovimientosBanco(
      [
        ["Fecha", "Concepto", "Importe"],
        ["30/07/2026", "Comisión mantenimiento", "-12,00"],
        ["30/07/2026", "Liquidación TPV", "300,00"],
      ],
      mapeo,
      "t1",
    );
    expect(movimientos).toHaveLength(1);
    expect(ignoradas[0]?.motivo).toContain("cargo");
  });

  it("usa la referencia del extracto cuando la trae", () => {
    const { movimientos } = leerMovimientosBanco(
      [
        ["Fecha", "Concepto", "Importe", "Referencia"],
        ["30/07/2026", "TPV", "100,00", "MOV-887766"],
      ],
      { ...mapeo, referencia: 3 },
      "t1",
    );
    expect(movimientos[0]?.referencia).toBe("MOV-887766");
    expect(movimientos[0]?.referenciaGenerada).toBe(false);
  });

  it("dos filas idénticas sin referencia propia: la segunda se marca, no se pierde en silencio", () => {
    const { movimientos, ignoradas } = leerMovimientosBanco(
      [
        ["Fecha", "Concepto", "Importe"],
        ["30/07/2026", "TPV", "100,00"],
        ["30/07/2026", "TPV", "100,00"],
      ],
      mapeo,
      "t1",
    );
    expect(movimientos).toHaveLength(1);
    expect(ignoradas[0]?.motivo).toContain("Repetida");
  });

  it("filas sin fecha o sin importe se cuentan como problema", () => {
    const { movimientos, ignoradas } = leerMovimientosBanco(
      [
        ["Fecha", "Concepto", "Importe"],
        ["", "TPV", "100,00"],
        ["30/07/2026", "TPV", "no consta"],
      ],
      mapeo,
      "t1",
    );
    expect(movimientos).toHaveLength(0);
    expect(ignoradas.map((x) => x.motivo)).toEqual(["Sin fecha reconocible", "Sin importe reconocible"]);
  });

  it("las filas vacías del final de la hoja no son un problema", () => {
    const { movimientos, ignoradas } = leerMovimientosBanco(
      [
        ["Fecha", "Concepto", "Importe"],
        ["30/07/2026", "TPV", "100,00"],
        ["", "", ""],
        [],
      ],
      mapeo,
      "t1",
    );
    expect(movimientos).toHaveLength(1);
    expect(ignoradas).toHaveLength(0);
  });

  it("sin cabecera, la primera fila también cuenta", () => {
    const { movimientos } = leerMovimientosBanco(
      [["30/07/2026", "TPV", "100,00"]],
      { ...mapeo, conCabecera: false },
      "t1",
    );
    expect(movimientos).toHaveLength(1);
  });

  it("columna de haber: se usa cuando la principal viene vacía", () => {
    const { movimientos } = leerMovimientosBanco(
      [
        ["Fecha", "Concepto", "Debe", "Haber"],
        ["30/07/2026", "TPV", "", "500,00"],
      ],
      { ...mapeo, importe: 2, importeHaber: 3 },
      "t1",
    );
    expect(movimientos[0]?.importe).toBe(500);
  });

  it("con soloPositivos, un extracto sin signo se lee como ingresos", () => {
    const { movimientos } = leerMovimientosBanco(
      [
        ["Fecha", "Concepto", "Importe"],
        ["30/07/2026", "TPV", "-300,00"],
      ],
      { ...mapeo, soloPositivos: true },
      "t1",
    );
    expect(movimientos[0]?.importe).toBe(300);
  });
});

describe("normalizarMapeo", () => {
  it("exige fecha e importe", () => {
    expect(normalizarMapeo({}).ok).toBe(false);
    expect(normalizarMapeo({ fecha: 0 }).ok).toBe(false);
    expect(normalizarMapeo(null).ok).toBe(false);
  });

  it("acepta índices como texto (vienen de un <select>)", () => {
    const r = normalizarMapeo({ fecha: "0", importe: "2", concepto: "1", referencia: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mapeo).toMatchObject({ fecha: 0, importe: 2, concepto: 1, referencia: null });
    }
  });

  it("rechaza columnas absurdas", () => {
    expect(normalizarMapeo({ fecha: -1, importe: 2 }).ok).toBe(false);
    expect(normalizarMapeo({ fecha: 0, importe: 999 }).ok).toBe(false);
  });

  it("el formato de fecha por defecto es el español", () => {
    const r = normalizarMapeo({ fecha: 0, importe: 1, formatoFecha: "loquesea" });
    expect(r.ok && r.mapeo.formatoFecha).toBe("dmy");
  });
});
