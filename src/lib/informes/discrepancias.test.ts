import { describe, it, expect } from "vitest";
import { detectarDiscrepancias, resumirDiscrepancias } from "./discrepancias";

const ZONA = "Europe/Madrid";

/** Entrada fichada a una hora de Madrid (verano: UTC+2). */
const entrada = (
  userId: string,
  dia: string,
  horaMadrid: string,
  tiendaId: string | null,
  distancia: number | null = null,
) => {
  const [h, m] = horaMadrid.split(":").map(Number);
  const utc = String(h! - 2).padStart(2, "0");
  return {
    userId,
    timestamp: new Date(`${dia}T${utc}:${String(m).padStart(2, "0")}:00Z`),
    tiendaId,
    distancia,
  };
};

const turno = (userId: string, dia: string, tiendaId: string | null, horaInicio = "10:00") => ({
  userId,
  fecha: new Date(`${dia}T00:00:00Z`),
  tiendaId,
  horaInicio,
});

describe("detectarDiscrepancias — ticket 5f83b0c7", () => {
  it("la sede del cuadrante y la del fichaje coinciden: no hay nada", () => {
    const r = detectarDiscrepancias({
      entradas: [entrada("ana", "2026-07-01", "10:00", "centro")],
      turnos: [turno("ana", "2026-07-01", "centro")],
      zona: ZONA,
    });
    expect(r).toEqual([]);
  });

  it("cuadrante en una tienda y fichaje en otra", () => {
    const r = detectarDiscrepancias({
      entradas: [entrada("ana", "2026-07-01", "10:05", "centro")],
      turnos: [turno("ana", "2026-07-01", "norte")],
      zona: ZONA,
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      tipo: "sede_distinta",
      sedeTurnoId: "norte",
      sedeFichajeId: "centro",
      hora: "10:05",
      dia: "2026-07-01",
    });
  });

  it("fichó un día sin turno publicado", () => {
    const r = detectarDiscrepancias({
      entradas: [entrada("ana", "2026-07-05", "09:30", "centro")],
      turnos: [],
      zona: ZONA,
    });
    expect(r[0]).toMatchObject({ tipo: "sin_turno", sedeTurnoId: null, sedeFichajeId: "centro" });
  });

  it("tenía turno y no fichó nada", () => {
    const r = detectarDiscrepancias({
      entradas: [],
      turnos: [turno("ana", "2026-07-01", "centro", "09:30")],
      zona: ZONA,
    });
    expect(r[0]).toMatchObject({
      tipo: "turno_sin_fichaje",
      sedeTurnoId: "centro",
      sedeFichajeId: null,
      hora: "09:30",
    });
  });

  it("una ausencia aprobada explica el turno sin fichaje", () => {
    const r = detectarDiscrepancias({
      entradas: [],
      turnos: [turno("ana", "2026-07-01", "centro")],
      ausencias: [
        {
          userId: "ana",
          fechaInicio: new Date("2026-06-29T00:00:00Z"),
          fechaFin: new Date("2026-07-04T00:00:00Z"),
        },
      ],
      zona: ZONA,
    });
    expect(r).toEqual([]);
  });

  it("con jornada partida en dos tiendas, cada fichaje cuadra con el suyo", () => {
    // Mañana en Centro, tarde en Norte. Ficha dos veces, una por tienda: nada
    // que reportar. Sin mirar todos los turnos del día, la entrada de Norte
    // habría salido como discrepancia contra el turno de Centro.
    const r = detectarDiscrepancias({
      entradas: [
        entrada("ana", "2026-07-01", "10:00", "centro"),
        entrada("ana", "2026-07-01", "17:00", "norte"),
      ],
      turnos: [turno("ana", "2026-07-01", "centro", "10:00"), turno("ana", "2026-07-01", "norte", "17:00")],
      zona: ZONA,
    });
    expect(r).toEqual([]);
  });

  it("un turno sin fichaje sale UNA vez, aunque ese día tuviera dos turnos", () => {
    const r = detectarDiscrepancias({
      entradas: [],
      turnos: [
        turno("ana", "2026-07-01", "centro", "10:00"),
        turno("ana", "2026-07-01", "centro", "17:00"),
      ],
      zona: ZONA,
    });
    // La incidencia es "no vino", no "le faltan dos fichajes".
    expect(r).toHaveLength(1);
  });

  it("señala la ubicación solo cuando pasa de los 2 km", () => {
    const cerca = detectarDiscrepancias({
      entradas: [entrada("ana", "2026-07-01", "10:00", "centro", 800)],
      turnos: [turno("ana", "2026-07-01", "norte")],
      zona: ZONA,
    });
    // 800 m: el GPS urbano se desvía, se da por hecho que estaba en su sede.
    expect(cerca[0]).toMatchObject({ distancia: 800, lejos: false });

    const lejos = detectarDiscrepancias({
      entradas: [entrada("ana", "2026-07-01", "10:00", "centro", 4200)],
      turnos: [turno("ana", "2026-07-01", "norte")],
      zona: ZONA,
    });
    expect(lejos[0]).toMatchObject({ distancia: 4200, lejos: true });
  });

  it("sin ubicación del móvil no se inventa nada", () => {
    const r = detectarDiscrepancias({
      entradas: [entrada("ana", "2026-07-01", "10:00", "centro", null)],
      turnos: [turno("ana", "2026-07-01", "norte")],
      zona: ZONA,
    });
    expect(r[0]).toMatchObject({ distancia: null, lejos: false });
  });

  it("usa la zona del cliente para decidir de qué día es el fichaje", () => {
    // 22:30Z del 1 son las 00:30 del 2 en Madrid: el fichaje es del día 2, y
    // ese día no tiene turno.
    const r = detectarDiscrepancias({
      entradas: [{ userId: "ana", timestamp: new Date("2026-07-01T22:30:00Z"), tiendaId: "centro", distancia: null }],
      turnos: [turno("ana", "2026-07-01", "centro")],
      zona: ZONA,
    });
    expect(r.map((d) => ({ tipo: d.tipo, dia: d.dia }))).toEqual([
      { tipo: "sin_turno", dia: "2026-07-02" },
      // Y el turno del día 1 se queda sin fichaje.
      { tipo: "turno_sin_fichaje", dia: "2026-07-01" },
    ]);
  });

  it("ordena de lo más reciente a lo más antiguo", () => {
    const r = detectarDiscrepancias({
      entradas: [
        entrada("ana", "2026-07-01", "10:00", "centro"),
        entrada("ana", "2026-07-10", "10:00", "centro"),
      ],
      turnos: [turno("ana", "2026-07-01", "norte"), turno("ana", "2026-07-10", "norte")],
      zona: ZONA,
    });
    expect(r.map((d) => d.dia)).toEqual(["2026-07-10", "2026-07-01"]);
  });

  it("resumirDiscrepancias cuenta por tipo", () => {
    const r = detectarDiscrepancias({
      entradas: [
        entrada("ana", "2026-07-01", "10:00", "centro"),
        entrada("luis", "2026-07-02", "10:00", "centro"),
      ],
      turnos: [turno("ana", "2026-07-01", "norte"), turno("eva", "2026-07-03", "centro")],
      zona: ZONA,
    });
    expect(resumirDiscrepancias(r)).toEqual({
      sede_distinta: 1,
      sin_turno: 1,
      turno_sin_fichaje: 1,
    });
  });
});
