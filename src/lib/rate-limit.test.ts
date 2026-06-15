import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isLocked, recordFailure, clearFailures, checkRate } from "./rate-limit";

const THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60_000;

// Claves únicas por test para no colisionar con el Map global compartido.
let n = 0;
const freshKey = () => `test:${n++}:${Math.random()}`;

describe("lockout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("un único intento fallido NO bloquea (regresión: antes bloqueaba 15 min)", () => {
    const key = freshKey();
    const res = recordFailure(key, THRESHOLD, LOCKOUT_MS);
    expect(res.locked).toBe(false);
    expect(isLocked(key).locked).toBe(false);
  });

  it("varios fallos por debajo del umbral siguen sin bloquear", () => {
    const key = freshKey();
    for (let i = 0; i < THRESHOLD - 1; i++) {
      expect(recordFailure(key, THRESHOLD, LOCKOUT_MS).locked).toBe(false);
    }
    expect(isLocked(key).locked).toBe(false);
  });

  it("bloquea al alcanzar el umbral", () => {
    const key = freshKey();
    let last;
    for (let i = 0; i < THRESHOLD; i++) {
      last = recordFailure(key, THRESHOLD, LOCKOUT_MS);
    }
    expect(last!.locked).toBe(true);
    expect(isLocked(key).locked).toBe(true);
  });

  it("el bloqueo expira pasado lockoutMs", () => {
    const key = freshKey();
    for (let i = 0; i < THRESHOLD; i++) recordFailure(key, THRESHOLD, LOCKOUT_MS);
    expect(isLocked(key).locked).toBe(true);
    vi.advanceTimersByTime(LOCKOUT_MS + 1);
    expect(isLocked(key).locked).toBe(false);
  });

  it("el contador se reinicia cuando su ventana caduca (no acumula entre ventanas)", () => {
    const key = freshKey();
    // 4 fallos, no bloquea
    for (let i = 0; i < THRESHOLD - 1; i++) recordFailure(key, THRESHOLD, LOCKOUT_MS);
    expect(isLocked(key).locked).toBe(false);
    // pasa la ventana entera → contador a cero
    vi.advanceTimersByTime(LOCKOUT_MS + 1);
    // un nuevo fallo NO debe disparar el bloqueo (sería el 5º si acumulara)
    expect(recordFailure(key, THRESHOLD, LOCKOUT_MS).locked).toBe(false);
    expect(isLocked(key).locked).toBe(false);
  });

  it("clearFailures desbloquea inmediatamente", () => {
    const key = freshKey();
    for (let i = 0; i < THRESHOLD; i++) recordFailure(key, THRESHOLD, LOCKOUT_MS);
    expect(isLocked(key).locked).toBe(true);
    clearFailures(key);
    expect(isLocked(key).locked).toBe(false);
  });
});

describe("checkRate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("permite hasta el límite y luego corta", () => {
    const key = freshKey();
    for (let i = 0; i < 10; i++) {
      expect(checkRate(key, 10, 60_000).ok).toBe(true);
    }
    expect(checkRate(key, 10, 60_000).ok).toBe(false);
  });

  it("se reabre al pasar la ventana", () => {
    const key = freshKey();
    for (let i = 0; i < 10; i++) checkRate(key, 10, 60_000);
    expect(checkRate(key, 10, 60_000).ok).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(checkRate(key, 10, 60_000).ok).toBe(true);
  });
});
