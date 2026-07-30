import { describe, it, expect } from "vitest";
import {
  minutosDeBloqueo,
  normalizarEfectivoArqueo,
  normalizarPin,
  normalizarSemana,
  pinBloqueado,
  PIN_BLOQUEO_MINUTOS,
  PIN_MAX_INTENTOS,
  rangoSemanaISO,
  semanaDeclarable,
  semanaISO,
  semanaLegible,
  trasAciertoPin,
  trasFalloPin,
} from "./arqueos";

describe("semanaISO", () => {
  it("un jueves normal", () => {
    expect(semanaISO(new Date("2026-07-30T00:00:00Z"))).toBe("2026-W31");
  });

  it("el lunes y el domingo de la misma semana coinciden", () => {
    expect(semanaISO(new Date("2026-07-27T00:00:00Z"))).toBe("2026-W31");
    expect(semanaISO(new Date("2026-08-02T00:00:00Z"))).toBe("2026-W31");
  });

  it("el 1 de enero puede caer en la última semana del año anterior", () => {
    // 2027-01-01 es viernes: pertenece a la semana 53 de 2026.
    expect(semanaISO(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
  });

  it("final de diciembre puede caer en la semana 1 del año siguiente", () => {
    // 2025-12-29 es lunes de la semana 1 de 2026.
    expect(semanaISO(new Date("2025-12-29T00:00:00Z"))).toBe("2026-W01");
  });
});

describe("rangoSemanaISO", () => {
  it("va de lunes a domingo", () => {
    const { desde, hasta } = rangoSemanaISO("2026-W31");
    expect(desde.toISOString()).toBe("2026-07-27T00:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-08-02T00:00:00.000Z");
  });

  it("es la inversa de semanaISO en cualquier día de la semana", () => {
    for (const dia of ["2026-01-01", "2026-03-15", "2026-12-31", "2027-01-03"]) {
      const s = semanaISO(new Date(`${dia}T00:00:00Z`));
      const { desde, hasta } = rangoSemanaISO(s);
      const d = new Date(`${dia}T00:00:00Z`).getTime();
      expect(d).toBeGreaterThanOrEqual(desde.getTime());
      expect(d).toBeLessThanOrEqual(hasta.getTime());
    }
  });

  it("la semana 1 de 2026 empieza el 29 de diciembre de 2025", () => {
    expect(rangoSemanaISO("2026-W01").desde.toISOString()).toBe("2025-12-29T00:00:00.000Z");
  });
});

describe("normalizarSemana", () => {
  it("acepta el formato ISO y normaliza la caja", () => {
    expect(normalizarSemana("2026-w31")).toEqual({ ok: true, semana: "2026-W31" });
  });

  it("rechaza semanas imposibles", () => {
    for (const malo of ["2026-W00", "2026-W54", "2026-31", "W31", "", null]) {
      expect(normalizarSemana(malo).ok).toBe(false);
    }
  });
});

describe("semanaLegible", () => {
  it("dice el rango en palabras", () => {
    expect(semanaLegible("2026-W31")).toBe("del 27 de julio al 2 de agosto");
  });
});

describe("normalizarPin", () => {
  it("acepta de 4 a 8 dígitos", () => {
    expect(normalizarPin("4729")).toEqual({ ok: true, pin: "4729" });
    expect(normalizarPin(83625197).ok).toBe(true);
  });

  it("rechaza lo que no son dígitos", () => {
    expect(normalizarPin("12a4").ok).toBe(false);
    expect(normalizarPin("").ok).toBe(false);
    expect(normalizarPin(null).ok).toBe(false);
  });

  it("rechaza longitudes fuera de rango", () => {
    expect(normalizarPin("123").ok).toBe(false);
    expect(normalizarPin("123456789").ok).toBe(false);
  });

  it("rechaza PIN evidentes", () => {
    for (const malo of ["0000", "1111", "1234", "12345", "4321", "9876"]) {
      const r = normalizarPin(malo);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("evidente");
    }
  });
});

describe("bloqueo del PIN", () => {
  const ahora = new Date("2026-07-30T20:00:00Z");

  it("sin bloqueo, se puede firmar", () => {
    expect(pinBloqueado({ intentos: 2, bloqueoHasta: null }, ahora)).toBe(false);
  });

  it("un bloqueo ya vencido no cuenta", () => {
    const estado = { intentos: 0, bloqueoHasta: new Date("2026-07-30T19:50:00Z") };
    expect(pinBloqueado(estado, ahora)).toBe(false);
    expect(minutosDeBloqueo(estado, ahora)).toBe(0);
  });

  it("los fallos suman hasta el tope y entonces bloquean", () => {
    let estado = { intentos: 0, bloqueoHasta: null as Date | null };
    for (let i = 1; i < PIN_MAX_INTENTOS; i++) {
      estado = trasFalloPin(estado, ahora);
      expect(pinBloqueado(estado, ahora)).toBe(false);
      expect(estado.intentos).toBe(i);
    }
    estado = trasFalloPin(estado, ahora);
    expect(pinBloqueado(estado, ahora)).toBe(true);
    expect(minutosDeBloqueo(estado, ahora)).toBe(PIN_BLOQUEO_MINUTOS);
    // El contador se reinicia: al vencer el bloqueo hay otros tantos intentos,
    // no un bloqueo permanente por una mala tarde.
    expect(estado.intentos).toBe(0);
  });

  it("acertar limpia intentos y bloqueo", () => {
    expect(trasAciertoPin()).toEqual({ intentos: 0, bloqueoHasta: null });
  });
});

describe("normalizarEfectivoArqueo", () => {
  it("acepta coma decimal y cero", () => {
    expect(normalizarEfectivoArqueo("1234,50")).toEqual({ ok: true, importe: 1234.5 });
    expect(normalizarEfectivoArqueo(0)).toEqual({ ok: true, importe: 0 });
  });

  it("rechaza negativos y disparates", () => {
    expect(normalizarEfectivoArqueo(-1).ok).toBe(false);
    expect(normalizarEfectivoArqueo("mucho").ok).toBe(false);
    expect(normalizarEfectivoArqueo(2_000_000).ok).toBe(false);
  });

  it("redondea a céntimos", () => {
    expect(normalizarEfectivoArqueo(10.005)).toEqual({ ok: true, importe: 10.01 });
  });
});

describe("semanaDeclarable", () => {
  const ahora = new Date("2026-07-30T12:00:00Z"); // semana 31

  it("la semana en curso y las pasadas, sí", () => {
    expect(semanaDeclarable("2026-W31", ahora)).toBe(true);
    expect(semanaDeclarable("2026-W30", ahora)).toBe(true);
  });

  it("una semana futura, no", () => {
    expect(semanaDeclarable("2026-W32", ahora)).toBe(false);
  });
});
