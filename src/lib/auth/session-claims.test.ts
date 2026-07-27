import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  freshUserClaims,
  _resetSessionClaimsCache,
  CLAIMS_TTL_MS,
  type UserClaims,
} from "@/lib/auth/session-claims";

const TOKEN = {
  id: "user-1",
  tenantId: "tenant-1",
  tenantSlug: "acme",
  rol: "EMPLEADO",
};

describe("freshUserClaims", () => {
  beforeEach(() => {
    _resetSessionClaimsCache();
    vi.useRealTimers();
  });

  it("devuelve el rol actual de BD (promoción a OWNER sin re-login)", async () => {
    const load = vi.fn(async (): Promise<UserClaims> => ({
      rol: "OWNER",
      tiendaId: null,
    }));

    const claims = await freshUserClaims(TOKEN, load);

    expect(claims).toEqual({ rol: "OWNER", tiendaId: null });
    expect(load).toHaveBeenCalledWith("tenant-1", "acme", "user-1");
  });

  it("cachea por (slug, userId) dentro del TTL", async () => {
    const load = vi.fn(async (): Promise<UserClaims> => ({
      rol: "OWNER",
      tiendaId: "sede-1",
    }));

    await freshUserClaims(TOKEN, load);
    await freshUserClaims(TOKEN, load);
    await freshUserClaims(TOKEN, load);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("vuelve a leer BD cuando expira el TTL", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async (): Promise<UserClaims> => ({
      rol: "MANAGER",
      tiendaId: "sede-1",
    }));

    await freshUserClaims(TOKEN, load);
    vi.advanceTimersByTime(CLAIMS_TTL_MS + 1);
    await freshUserClaims(TOKEN, load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("no cachea entre tenants distintos con el mismo userId", async () => {
    const load = vi.fn(async (_t: string, slug: string): Promise<UserClaims> => ({
      rol: slug === "acme" ? "OWNER" : "EMPLEADO",
      tiendaId: null,
    }));

    const a = await freshUserClaims(TOKEN, load);
    const b = await freshUserClaims({ ...TOKEN, tenantSlug: "otra" }, load);

    expect(a?.rol).toBe("OWNER");
    expect(b?.rol).toBe("EMPLEADO");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("usa `sub` como id si el token no trae `id`", async () => {
    const load = vi.fn(async (): Promise<UserClaims> => ({
      rol: "OWNER",
      tiendaId: null,
    }));

    await freshUserClaims(
      { sub: "user-2", tenantId: "tenant-1", tenantSlug: "acme" },
      load,
    );

    expect(load).toHaveBeenCalledWith("tenant-1", "acme", "user-2");
  });

  it("devuelve null si el token no tiene tenant o id (no toca BD)", async () => {
    const load = vi.fn();

    expect(await freshUserClaims({}, load)).toBeNull();
    expect(await freshUserClaims({ id: "user-1" }, load)).toBeNull();
    expect(await freshUserClaims({ tenantSlug: "acme" }, load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("devuelve null si la BD falla (conserva los claims del JWT)", async () => {
    const load = vi.fn(async () => {
      throw new Error("connection refused");
    });

    expect(await freshUserClaims(TOKEN, load)).toBeNull();
  });

  it("devuelve null si el usuario ya no existe", async () => {
    const load = vi.fn(async () => null);

    expect(await freshUserClaims(TOKEN, load)).toBeNull();
  });
});
