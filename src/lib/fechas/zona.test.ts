import { describe, it, expect } from "vitest";
import { fechaEnZona, fechaHoraEnZona, ZONA_DEFECTO } from "./zona";

describe("fechaHoraEnZona — ticket 3c91f0ab", () => {
  // El caso real: salida de las 16:00 de Madrid, guardada como 14:00 UTC.
  const salida = new Date("2026-07-31T14:00:00Z");

  it("escribe la hora del cliente, no la del servidor", () => {
    expect(fechaHoraEnZona(salida, "Europe/Madrid")).toBe("31/07/2026, 16:00");
  });

  it("sin zona usa la de por defecto, que es la del producto", () => {
    expect(fechaHoraEnZona(salida)).toBe(fechaHoraEnZona(salida, ZONA_DEFECTO));
    expect(fechaHoraEnZona(salida)).toBe("31/07/2026, 16:00");
  });

  it("respeta el invierno (CET, +01:00)", () => {
    expect(fechaHoraEnZona(new Date("2026-01-15T15:00:00Z"), "Europe/Madrid")).toBe(
      "15/01/2026, 16:00",
    );
  });

  it("una zona inventada no tumba el correo: cae al default", () => {
    expect(fechaHoraEnZona(salida, "Marte/Olympus")).toBe("31/07/2026, 16:00");
  });

  it("acepta una fecha en texto, que es como llega de la BD a veces", () => {
    expect(fechaHoraEnZona("2026-07-31T14:00:00Z", "Europe/Madrid")).toBe("31/07/2026, 16:00");
  });

  it("otra zona da otra hora: no está atado a Madrid", () => {
    expect(fechaHoraEnZona(salida, "Atlantic/Canary")).toBe("31/07/2026, 15:00");
  });
});

describe("fechaEnZona", () => {
  it("un instante de madrugada cae en el día del cliente, no en el de UTC", () => {
    // 23:30 UTC del día 30 son las 01:30 del 31 en Madrid.
    expect(fechaEnZona(new Date("2026-07-30T23:30:00Z"), "Europe/Madrid")).toBe(
      "31 de julio de 2026",
    );
  });
});
