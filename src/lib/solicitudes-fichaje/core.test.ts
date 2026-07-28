import { describe, it, expect } from "vitest";
import {
  puedeResolverSolicitud,
  normalizarCrearSolicitud,
  buildFichajeCreate,
  buildFichajeUpdate,
  notaFichaje,
} from "./core";

describe("puedeResolverSolicitud", () => {
  it("OWNER siempre puede por rol", () => {
    expect(puedeResolverSolicitud("OWNER")).toBe(true);
  });

  it("MANAGER (Coordinador) ya no puede por rol", () => {
    // El Coordinador tiene permisos de empleado en escritura; solo resuelve
    // como aprobador designado (aprobadorId), que el handler comprueba aparte.
    expect(puedeResolverSolicitud("MANAGER")).toBe(false);
  });

  it("EMPLEADO nunca por rol", () => {
    expect(puedeResolverSolicitud("EMPLEADO")).toBe(false);
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

describe("clase fuera_sede (ticket #61)", () => {
  const ahora = new Date("2026-06-25T12:00:00Z");
  const base = {
    clase: "fuera_sede",
    tipo: "ENTRADA",
    fechaHora: "2026-06-25T09:00:00Z",
    motivo: "Reparto en casa de un cliente",
  };

  it("acepta el intento con coordenadas y conserva la geo", () => {
    const r = normalizarCrearSolicitud(
      { ...base, latitud: 40.4168, longitud: -3.7038, distancia: 1234.6 },
      ahora,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.clase).toBe("fuera_sede");
      expect(r.data.latitud).toBe(40.4168);
      expect(r.data.longitud).toBe(-3.7038);
      expect(r.data.distancia).toBe(1235);
    }
  });

  it("rechaza el intento sin coordenadas", () => {
    const r = normalizarCrearSolicitud(base, ahora);
    expect(r.ok).toBe(false);
  });

  it("rechaza coordenadas fuera de rango", () => {
    const r = normalizarCrearSolicitud({ ...base, latitud: 120, longitud: 0 }, ahora);
    expect(r.ok).toBe(false);
  });

  it("acepta distancia ausente (la recalcula el servidor)", () => {
    const r = normalizarCrearSolicitud({ ...base, latitud: 40.4, longitud: -3.7 }, ahora);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.distancia).toBeNull();
  });

  it("exige motivo como cualquier otra solicitud", () => {
    const r = normalizarCrearSolicitud(
      { ...base, motivo: "x", latitud: 40.4, longitud: -3.7 },
      ahora,
    );
    expect(r.ok).toBe(false);
  });

  it("las clases sin geo no arrastran coordenadas", () => {
    const r = normalizarCrearSolicitud(
      { clase: "olvido", tipo: "ENTRADA", fechaHora: "2026-06-25T09:00:00Z", motivo: "Olvido", latitud: 40.4, longitud: -3.7 },
      ahora,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.latitud).toBeNull();
      expect(r.data.longitud).toBeNull();
    }
  });

  it("el fichaje aprobado hereda dónde se fichó", () => {
    const d = buildFichajeCreate({
      solicitanteId: "u1",
      tiendaId: "t1",
      tipo: "ENTRADA",
      fechaHora: new Date("2026-06-25T09:00:00Z"),
      resolverId: "u2",
      nota: "nota",
      latitud: 40.4168,
      longitud: -3.7038,
      distancia: 1235,
    });
    expect(d.latitud).toBe(40.4168);
    expect(d.distancia).toBe(1235);
  });

  it("la nota distingue el fichaje fuera de sede", () => {
    const n = notaFichaje("Reparto", "Sandra", "fuera_sede");
    expect(n).toContain("fuera de la sede");
    expect(n).toContain("Reparto");
  });
});
