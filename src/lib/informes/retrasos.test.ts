import { describe, it, expect } from "vitest";
import { calcularRetrasos } from "./retrasos";

/** Turno de mañana de Ana: 10:00, el del ejemplo que puso el cliente. */
const turno = (userId: string, dia: string, horaInicio: string) => ({
  userId,
  fecha: new Date(`${dia}T00:00:00Z`),
  horaInicio,
});

/** Entrada fichada a una hora de Madrid (verano: UTC+2). */
const entrada = (userId: string, dia: string, horaMadrid: string) => {
  const [h, m] = horaMadrid.split(":").map(Number);
  const utc = String(h! - 2).padStart(2, "0");
  return { userId, timestamp: new Date(`${dia}T${utc}:${String(m).padStart(2, "0")}:00Z`) };
};

const ZONA = "Europe/Madrid";

describe("calcularRetrasos — ticket 4a71c8d3", () => {
  it("una entrada pasado el margen es un retraso, con sus minutos", () => {
    // 10:25 sobre un turno de 10:00 con 15 min de cortesía: 25 minutos tarde.
    const r = calcularRetrasos({
      entradas: [entrada("ana", "2026-07-01", "10:25")],
      turnos: [turno("ana", "2026-07-01", "10:00")],
      margenMin: 15,
      zona: ZONA,
    });
    expect(r).toEqual([
      {
        userId: "ana",
        turnosConEntrada: 1,
        retrasos: 1,
        minutosTotales: 25,
        peorRetraso: 25,
        ultimoRetraso: "2026-07-01",
      },
    ]);
  });

  it("dentro del margen no es retraso, pero el turno se cuenta", () => {
    const r = calcularRetrasos({
      entradas: [entrada("ana", "2026-07-01", "10:10")],
      turnos: [turno("ana", "2026-07-01", "10:00")],
      margenMin: 15,
      zona: ZONA,
    });
    expect(r[0]).toMatchObject({ turnosConEntrada: 1, retrasos: 0, minutosTotales: 0 });
  });

  it("llegar antes de la hora no es un retraso negativo", () => {
    const r = calcularRetrasos({
      entradas: [entrada("ana", "2026-07-01", "09:40")],
      turnos: [turno("ana", "2026-07-01", "10:00")],
      margenMin: 15,
      zona: ZONA,
    });
    expect(r[0]).toMatchObject({ retrasos: 0, minutosTotales: 0 });
  });

  it("ordena por número de retrasos y, a igualdad, por minutos", () => {
    const r = calcularRetrasos({
      entradas: [
        // Ana: 2 retrasos (20 + 20 min)
        entrada("ana", "2026-07-01", "10:20"),
        entrada("ana", "2026-07-02", "10:20"),
        // Luis: 2 retrasos, pero de más minutos (60 + 40)
        entrada("luis", "2026-07-01", "11:00"),
        entrada("luis", "2026-07-02", "10:40"),
        // Eva: 1 retraso
        entrada("eva", "2026-07-01", "10:30"),
      ],
      turnos: [
        turno("ana", "2026-07-01", "10:00"),
        turno("ana", "2026-07-02", "10:00"),
        turno("luis", "2026-07-01", "10:00"),
        turno("luis", "2026-07-02", "10:00"),
        turno("eva", "2026-07-01", "10:00"),
      ],
      margenMin: 15,
      zona: ZONA,
    });
    expect(r.map((f) => f.userId)).toEqual(["luis", "ana", "eva"]);
    expect(r[0]!.minutosTotales).toBe(100);
  });

  it("sin turno publicado ese día no se mide nada", () => {
    const r = calcularRetrasos({
      entradas: [entrada("ana", "2026-07-01", "12:00")],
      turnos: [],
      margenMin: 15,
      zona: ZONA,
    });
    expect(r).toEqual([]);
  });

  it("con jornada partida cada entrada se mide con SU turno", () => {
    // Mañana 10:00 (entra a las 10:05, puntual) y tarde 17:00 (entra 17:40).
    const r = calcularRetrasos({
      entradas: [entrada("ana", "2026-07-01", "10:05"), entrada("ana", "2026-07-01", "17:40")],
      turnos: [turno("ana", "2026-07-01", "10:00"), turno("ana", "2026-07-01", "17:00")],
      margenMin: 15,
      zona: ZONA,
    });
    // Dos turnos medidos y un solo retraso, el de la tarde: 40 minutos. Sin
    // emparejar por turno, la entrada de la tarde habría contado como 460
    // minutos de retraso sobre el turno de la mañana.
    expect(r[0]).toMatchObject({ turnosConEntrada: 2, retrasos: 1, minutosTotales: 40 });
  });

  it("dos entradas del mismo turno cuentan una vez: vale cuando llegó", () => {
    const r = calcularRetrasos({
      entradas: [entrada("ana", "2026-07-01", "10:30"), entrada("ana", "2026-07-01", "10:45")],
      turnos: [turno("ana", "2026-07-01", "10:00")],
      margenMin: 15,
      zona: ZONA,
    });
    expect(r[0]).toMatchObject({ turnosConEntrada: 1, retrasos: 1, minutosTotales: 30 });
  });

  it("guarda el peor retraso y el día del último", () => {
    const r = calcularRetrasos({
      entradas: [
        entrada("ana", "2026-07-01", "11:00"),
        entrada("ana", "2026-07-03", "10:20"),
      ],
      turnos: [turno("ana", "2026-07-01", "10:00"), turno("ana", "2026-07-03", "10:00")],
      margenMin: 15,
      zona: ZONA,
    });
    expect(r[0]).toMatchObject({ peorRetraso: 60, ultimoRetraso: "2026-07-03" });
  });

  it("con margen 0 cualquier minuto cuenta", () => {
    const r = calcularRetrasos({
      entradas: [entrada("ana", "2026-07-01", "10:01")],
      turnos: [turno("ana", "2026-07-01", "10:00")],
      margenMin: 0,
      zona: ZONA,
    });
    expect(r[0]).toMatchObject({ retrasos: 1, minutosTotales: 1 });
  });

  it("compara en la zona del cliente, no en la del servidor", () => {
    // 08:25Z son las 10:25 de Madrid: 25 minutos tarde. Sin convertir la zona,
    // parecerían casi dos horas de adelanto.
    const r = calcularRetrasos({
      entradas: [{ userId: "ana", timestamp: new Date("2026-07-01T08:25:00Z") }],
      turnos: [turno("ana", "2026-07-01", "10:00")],
      margenMin: 15,
      zona: ZONA,
    });
    expect(r[0]).toMatchObject({ retrasos: 1, minutosTotales: 25 });
  });
});
