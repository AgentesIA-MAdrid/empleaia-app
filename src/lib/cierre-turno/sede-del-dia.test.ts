import { describe, it, expect } from "vitest";
import { sugerirSedeDelDia } from "./sede-del-dia";

/** Tres tiendas reales de Madrid, con sus coordenadas aproximadas. */
const SEDES = [
  { id: "vaguada", nombre: "YOIGO CC LA VAGUADA", latitud: 40.4795, longitud: -3.7095 },
  { id: "pozuelo", nombre: "NEKSUS ECI POZUELO", latitud: 40.4361, longitud: -3.8134 },
  { id: "sinCoords", nombre: "NEKSUS SIN COORDENADAS", latitud: null, longitud: null },
];

describe("sugerirSedeDelDia — ticket 8c05f3e1", () => {
  it("manda dónde fichó, por encima del cuadrante", () => {
    // Ficha a 50 m de La Vaguada pero el cuadrante le pone en Pozuelo: el
    // cuadrante está mal, y la ubicación lo pilla.
    const r = sugerirSedeDelDia({
      fichaje: { latitud: 40.48, longitud: -3.7095 },
      turnoTiendaId: "pozuelo",
      fichaTiendaId: "pozuelo",
      sedes: SEDES,
    });
    expect(r.motivo).toBe("ubicacion");
    expect(r.sedeId).toBe("vaguada");
    expect(r.distancia).toBeLessThan(100);
  });

  it("con el GPS lejos no se fía: cae al cuadrante", () => {
    // A 8 km, la tienda "más cercana" no significa nada.
    const r = sugerirSedeDelDia({
      fichaje: { latitud: 40.55, longitud: -3.70 },
      turnoTiendaId: "pozuelo",
      fichaTiendaId: null,
      sedes: SEDES,
    });
    expect(r).toEqual({ sedeId: "pozuelo", motivo: "turno", distancia: null });
  });

  it("sin ubicación usa el cuadrante", () => {
    const r = sugerirSedeDelDia({
      fichaje: null,
      turnoTiendaId: "vaguada",
      fichaTiendaId: "pozuelo",
      sedes: SEDES,
    });
    expect(r).toEqual({ sedeId: "vaguada", motivo: "turno", distancia: null });
  });

  it("sin ubicación ni cuadrante, la sede de su ficha", () => {
    const r = sugerirSedeDelDia({
      fichaje: null,
      turnoTiendaId: null,
      fichaTiendaId: "pozuelo",
      sedes: SEDES,
    });
    expect(r).toEqual({ sedeId: "pozuelo", motivo: "ficha", distancia: null });
  });

  it("un correturnos sin nada de nada: que la elija él", () => {
    // Este es el caso que reportó el cliente: sin sede en la ficha, sin turno y
    // sin ubicación. Antes se le decía "no tienes sede asignada" y se acabó.
    const r = sugerirSedeDelDia({
      fichaje: null,
      turnoTiendaId: null,
      fichaTiendaId: null,
      sedes: SEDES,
    });
    expect(r).toEqual({ sedeId: null, motivo: "ninguna", distancia: null });
  });

  it("no propone una sede que ya no está activa", () => {
    // `sedes` son solo las activas: un turno o una ficha que apunten a una
    // tienda cerrada no valen como pista.
    const r = sugerirSedeDelDia({
      fichaje: null,
      turnoTiendaId: "cerrada",
      fichaTiendaId: "tambien_cerrada",
      sedes: SEDES,
    });
    expect(r.sedeId).toBeNull();
  });

  it("las sedes sin coordenadas no compiten por cercanía", () => {
    const r = sugerirSedeDelDia({
      fichaje: { latitud: 40.48, longitud: -3.7095 },
      turnoTiendaId: null,
      fichaTiendaId: null,
      sedes: SEDES,
    });
    expect(r.sedeId).toBe("vaguada");
  });

  it("el tope de distancia se puede ajustar", () => {
    const lejos = { latitud: 40.49, longitud: -3.7095 }; // ~1,1 km de La Vaguada
    expect(sugerirSedeDelDia({ fichaje: lejos, turnoTiendaId: null, fichaTiendaId: null, sedes: SEDES }).sedeId).toBeNull();
    expect(
      sugerirSedeDelDia({
        fichaje: lejos,
        turnoTiendaId: null,
        fichaTiendaId: null,
        sedes: SEDES,
        maxDistanciaM: 2000,
      }).sedeId,
    ).toBe("vaguada");
  });
});
