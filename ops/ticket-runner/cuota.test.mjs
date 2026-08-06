/**
 * Lo que se protege aquí es la lectura del motivo de muerte de una ejecución de
 * Claude, que es donde falló el ticket #0091:
 *
 *  1. Un 429 de cuota se distingue de un fallo del ticket. Confundirlos quemaba
 *     el job (y el intento del cliente) por algo que no era del ticket.
 *  2. El motivo que se enseña en el panel sale del evento `result` (stdout),
 *     no de stderr: stderr traía un warning de stdin que tapaba el error real.
 *  3. La pausa del runner tiene suelo y techo: sin suelo, la vuelta a la cola
 *     es un bucle caliente; sin techo, un `resetsAt` largo deja el runner ciego.
 */

import { describe, it, expect } from "vitest";
import {
  PAUSA_MAX_MS,
  PAUSA_MIN_MS,
  avisoDeCuota,
  limiteDeCuota,
  motivoDeMuerte,
  msDePausa,
} from "./cuota.mjs";

/** La salida real del CLI el 5-ago-2026 con la cuota semanal agotada. */
const SIN_CUOTA = {
  code: 1,
  apiErrorStatus: 429,
  rateLimit: {
    status: "rejected",
    resetsAt: 1786021200,
    rateLimitType: "seven_day",
    overageStatus: "rejected",
    overageDisabledReason: "org_level_disabled",
  },
  resultText: "You've hit your weekly limit · resets 1pm (UTC)",
  stderr: "Warning: no stdin data received in 3s, proceeding without it.",
  stdout: "",
};

describe("límite de cuota", () => {
  it("reconoce el 429 con su tipo de límite y su hora de vuelta", () => {
    const cuota = limiteDeCuota(SIN_CUOTA);
    expect(cuota).toEqual({ tipo: "límite semanal", resetsAt: 1786021200000 });
  });

  it("basta el rate_limit_event rechazado, sin api_error_status", () => {
    const cuota = limiteDeCuota({
      code: 1,
      apiErrorStatus: null,
      rateLimit: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1786021200 },
    });
    expect(cuota).toMatchObject({ tipo: "límite de 5 horas" });
  });

  it("un límite desconocido no se inventa nombre, pero sigue siendo límite", () => {
    const cuota = limiteDeCuota({
      code: 1,
      apiErrorStatus: 429,
      rateLimit: { status: "rejected", rateLimitType: "algo_nuevo" },
    });
    expect(cuota).toEqual({ tipo: "límite de uso", resetsAt: null });
  });

  it("un fallo que no es de cuota no se disfraza de cuota", () => {
    expect(limiteDeCuota({ code: 1, apiErrorStatus: 500, rateLimit: null })).toBeNull();
    expect(limiteDeCuota({ code: 2, resultText: "Error: no such file" })).toBeNull();
    // Un rate_limit_event informativo (aún con cuota) tampoco lo es.
    expect(
      limiteDeCuota({ code: 1, rateLimit: { status: "allowed", rateLimitType: "seven_day" } }),
    ).toBeNull();
  });

  it("el aviso dice cuándo vuelve y que no hay que relanzar nada", () => {
    const aviso = avisoDeCuota(limiteDeCuota(SIN_CUOTA));
    expect(aviso).toContain("límite semanal");
    expect(aviso).toContain("6 ago"); // hora de Madrid, no epoch
    expect(aviso).toContain("se reintenta solo");
  });
});

describe("pausa del runner", () => {
  const ahora = 1786000000000;

  it("espera hasta que vuelve la cuota", () => {
    // resetsAt a 20 minutos: se espera justo eso.
    expect(msDePausa({ resetsAt: ahora + 20 * 60_000 }, ahora)).toBe(20 * 60_000);
  });

  it("nunca menos del suelo, aunque el reset ya haya pasado", () => {
    expect(msDePausa({ resetsAt: ahora - 60_000 }, ahora)).toBe(PAUSA_MIN_MS);
    expect(msDePausa({ resetsAt: null }, ahora)).toBe(PAUSA_MIN_MS);
  });

  it("nunca más del techo, para volver a preguntar", () => {
    expect(msDePausa({ resetsAt: ahora + 20 * 3_600_000 }, ahora)).toBe(PAUSA_MAX_MS);
  });
});

describe("motivo de muerte", () => {
  it("se queda con el texto del CLI, no con el warning de stderr", () => {
    const motivo = motivoDeMuerte({
      code: 1,
      apiErrorStatus: 500,
      resultText: "API Error: internal server error",
      stderr: "Warning: no stdin data received in 3s",
    });
    expect(motivo).toContain("HTTP 500");
    expect(motivo).toContain("API Error: internal server error");
    // El warning se conserva detrás, pero ya no es lo primero que se lee.
    expect(motivo.indexOf("API Error")).toBeLessThan(motivo.indexOf("Warning"));
  });

  it("sin nada que contar lo dice, en vez de quedarse en blanco", () => {
    expect(motivoDeMuerte({ code: 137 })).toBe("claude salió con código 137: sin salida");
  });

  it("recorta el detalle para que quepa en el campo del job", () => {
    const motivo = motivoDeMuerte({ code: 1, resultText: "x".repeat(5000) });
    expect(motivo.length).toBeLessThanOrEqual(3000 + "claude salió con código 1: ".length);
  });
});
