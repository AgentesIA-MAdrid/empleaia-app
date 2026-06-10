/**
 * Tests del matcher de PUBLIC_AUTH_PATHS. Bug 5 Fase 4: el matcher
 * laxo (startsWith sin slash final) podría matchear paths espurios
 * como /loginfake o /set-passwordX.
 */

import { describe, it, expect } from "vitest";
import { isPublicAuthPath, PUBLIC_AUTH_PATHS } from "./proxy-paths";

describe("isPublicAuthPath", () => {
  it("matchea /login exacto", () => {
    expect(isPublicAuthPath("/login")).toBe(true);
  });

  it("matchea /set-password exacto", () => {
    expect(isPublicAuthPath("/set-password")).toBe(true);
  });

  it("matchea /set-password con query (el matcher recibe pathname puro, query no afecta)", () => {
    // El caller pasa nextUrl.pathname que es solo el path, no query.
    expect(isPublicAuthPath("/set-password")).toBe(true);
  });

  it("matchea /login/anidado (subroute)", () => {
    expect(isPublicAuthPath("/login/extra")).toBe(true);
  });

  it("NO matchea /loginfake (path similar pero no exacto, sin slash)", () => {
    expect(isPublicAuthPath("/loginfake")).toBe(false);
  });

  it("NO matchea /set-passwordfake (path similar pero no exacto)", () => {
    expect(isPublicAuthPath("/set-passwordfake")).toBe(false);
  });

  it("NO matchea /admin (ruta privada)", () => {
    expect(isPublicAuthPath("/admin")).toBe(false);
  });

  it("NO matchea raíz /", () => {
    expect(isPublicAuthPath("/")).toBe(false);
  });

  it("NO matchea cadena vacía", () => {
    expect(isPublicAuthPath("")).toBe(false);
  });

  it("NO matchea path con prefijo /login pero sin slash inmediato (login123)", () => {
    expect(isPublicAuthPath("/login123")).toBe(false);
  });
});

describe("PUBLIC_AUTH_PATHS", () => {
  it("incluye /login, /set-password y /recuperar-password", () => {
    expect(PUBLIC_AUTH_PATHS).toContain("/login");
    expect(PUBLIC_AUTH_PATHS).toContain("/set-password");
    expect(PUBLIC_AUTH_PATHS).toContain("/recuperar-password");
  });

  it("3 paths del flujo de auth (login, set-password, recuperar-password)", () => {
    expect(PUBLIC_AUTH_PATHS).toHaveLength(3);
  });
});
