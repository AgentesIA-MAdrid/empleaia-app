import { describe, it, expect } from "vitest";
import { canEnqueue, applyJobEvent } from "../ai-jobs";

describe("canEnqueue", () => {
  it("permite encolar si no hay job previo", () => {
    expect(canEnqueue(null)).toBe(true);
  });

  it("bloquea si hay un job vivo (encolado o ejecutando)", () => {
    expect(canEnqueue({ status: "encolado" })).toBe(false);
    expect(canEnqueue({ status: "ejecutando" })).toBe(false);
  });

  it("permite re-encolar si el último job es terminal", () => {
    expect(canEnqueue({ status: "pr_abierto" })).toBe(true);
    expect(canEnqueue({ status: "sin_cambios" })).toBe(true);
    expect(canEnqueue({ status: "fallido" })).toBe(true);
  });
});

describe("applyJobEvent", () => {
  it("encolado → ejecutando (el runner reclama)", () => {
    expect(applyJobEvent("encolado", "ejecutando")).toEqual({ ok: true, next: "ejecutando" });
  });

  it("ejecutando → cualquier terminal", () => {
    expect(applyJobEvent("ejecutando", "pr_abierto")).toEqual({ ok: true, next: "pr_abierto" });
    expect(applyJobEvent("ejecutando", "sin_cambios")).toEqual({ ok: true, next: "sin_cambios" });
    expect(applyJobEvent("ejecutando", "fallido")).toEqual({ ok: true, next: "fallido" });
  });

  it("encolado → fallido (reclaim de job nunca arrancado)", () => {
    expect(applyJobEvent("encolado", "fallido")).toEqual({ ok: true, next: "fallido" });
  });

  it("es idempotente: re-aplicar el mismo terminal es no-op ok", () => {
    expect(applyJobEvent("pr_abierto", "pr_abierto")).toEqual({ ok: true, next: "pr_abierto" });
    expect(applyJobEvent("fallido", "fallido")).toEqual({ ok: true, next: "fallido" });
  });

  it("rechaza transiciones inválidas", () => {
    expect(applyJobEvent("pr_abierto", "ejecutando").ok).toBe(false);
    expect(applyJobEvent("ejecutando", "encolado").ok).toBe(false);
    expect(applyJobEvent("sin_cambios", "pr_abierto").ok).toBe(false);
  });
});
