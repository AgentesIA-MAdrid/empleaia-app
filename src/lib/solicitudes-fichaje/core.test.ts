import { describe, it, expect } from "vitest";
import {
  puedeResolverSolicitud,
  normalizarCrearSolicitud,
  buildFichajeCreate,
  buildFichajeUpdate,
  notaFichaje,
} from "./core";

describe("puedeResolverSolicitud", () => {
  it("OWNER siempre puede", () => {
    expect(puedeResolverSolicitud("OWNER", null, "t1")).toBe(true);
    expect(puedeResolverSolicitud("OWNER", "t9", null)).toBe(true);
  });

  it("MANAGER solo en su misma tienda", () => {
    expect(puedeResolverSolicitud("MANAGER", "t1", "t1")).toBe(true);
    expect(puedeResolverSolicitud("MANAGER", "t1", "t2")).toBe(false);
    expect(puedeResolverSolicitud("MANAGER", null, null)).toBe(false);
    expect(puedeResolverSolicitud("MANAGER", "t1", null)).toBe(false);
  });

  it("EMPLEADO nunca por rol", () => {
    expect(puedeResolverSolicitud("EMPLEADO", "t1", "t1")).toBe(false);
  });
});

describe("normalizarCrearSolicitud", () => {
  const ahora = new Date("2026-06-25T12:00:00Z");

  it("acepta un olvido válido", () => {
    const r = normalizarCrearSolicitud(
      { clase: "olvido", tipo: "ENTRADA", fechaHora: "2026-06-25T09:00:00Z", motivo: "Olvidé fichar" },
      ahora,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.clase).toBe("olvido");
      expect(r.data.tipo).toBe("ENTRADA");
      expect(r.data.fichajeId).toBeNull();
    }
  });

  it("clase por defecto = olvido", () => {
    const r = normalizarCrearSolicitud(
      { tipo: "SALIDA", fechaHora: "2026-06-25T09:00:00Z", motivo: "motivo" },
      ahora,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.clase).toBe("olvido");
  });

  it("rechaza tipo inválido", () => {
    const r = normalizarCrearSolicitud(
      { tipo: "ALMUERZO", fechaHora: "2026-06-25T09:00:00Z", motivo: "motivo" },
      ahora,
    );
    expect(r.ok).toBe(false);
  });

  it("rechaza hora futura", () => {
    const r = normalizarCrearSolicitud(
      { tipo: "ENTRADA", fechaHora: "2026-06-25T18:00:00Z", motivo: "motivo" },
      ahora,
    );
    expect(r.ok).toBe(false);
  });

  it("rechaza motivo corto", () => {
    const r = normalizarCrearSolicitud(
      { tipo: "ENTRADA", fechaHora: "2026-06-25T09:00:00Z", motivo: "x" },
      ahora,
    );
    expect(r.ok).toBe(false);
  });

  it("corrección exige fichajeId", () => {
    const sin = normalizarCrearSolicitud(
      { clase: "correccion", tipo: "ENTRADA", fechaHora: "2026-06-25T09:00:00Z", motivo: "motivo" },
      ahora,
    );
    expect(sin.ok).toBe(false);
    const con = normalizarCrearSolicitud(
      { clase: "correccion", tipo: "ENTRADA", fechaHora: "2026-06-25T09:00:00Z", motivo: "motivo", fichajeId: "f1" },
      ahora,
    );
    expect(con.ok).toBe(true);
    if (con.ok) expect(con.data.fichajeId).toBe("f1");
  });
});

describe("build fichaje data", () => {
  const fechaHora = new Date("2026-06-25T09:00:00Z");

  it("create marca MANUAL y atribuye al resolutor", () => {
    const d = buildFichajeCreate({
      solicitanteId: "u1",
      tiendaId: "t1",
      tipo: "ENTRADA",
      fechaHora,
      resolverId: "u2",
      nota: "nota",
    });
    expect(d.metodo).toBe("MANUAL");
    expect(d.userId).toBe("u1");
    expect(d.tiendaId).toBe("t1");
    expect(d.editadoPor).toBe("u2");
    expect(d.timestamp).toBe(fechaHora);
  });

  it("update marca MANUAL", () => {
    const d = buildFichajeUpdate({ tipo: "SALIDA", fechaHora, resolverId: "u2", nota: "nota" });
    expect(d.metodo).toBe("MANUAL");
    expect(d.tipo).toBe("SALIDA");
    expect(d.editadoPor).toBe("u2");
  });

  it("notaFichaje incluye resolutor y motivo", () => {
    const n = notaFichaje("Olvidé fichar", "Sandra");
    expect(n).toContain("Sandra");
    expect(n).toContain("Olvidé fichar");
  });
});
