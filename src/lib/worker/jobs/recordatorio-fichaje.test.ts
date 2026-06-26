import { describe, it, expect } from "vitest";
import { hhmmToMin, turnosOlvidados } from "./recordatorio-fichaje";

const turno = (id: string, userId: string, horaInicio: string, horaFin: string) => ({
  id,
  userId,
  horaInicio,
  horaFin,
});

describe("hhmmToMin", () => {
  it("convierte HH:MM a minutos", () => {
    expect(hhmmToMin("09:00")).toBe(540);
    expect(hhmmToMin("17:30")).toBe(1050);
    expect(hhmmToMin("0:0")).toBe(0);
  });
});

describe("turnosOlvidados", () => {
  const base = { graciaMin: 15, entradasUserIds: new Set<string>() };

  it("marca olvidado si pasó inicio+gracia y no hay entrada", () => {
    const r = turnosOlvidados({
      ...base,
      turnos: [turno("t1", "ana", "09:00", "17:00")],
      nowMinutos: 9 * 60 + 30, // 09:30
    });
    expect(r.map((t) => t.id)).toEqual(["t1"]);
  });

  it("no avisa antes del margen de gracia", () => {
    const r = turnosOlvidados({
      ...base,
      turnos: [turno("t1", "ana", "09:00", "17:00")],
      nowMinutos: 9 * 60 + 10, // 09:10 < 09:15
    });
    expect(r).toHaveLength(0);
  });

  it("no avisa si ya fichó la entrada", () => {
    const r = turnosOlvidados({
      ...base,
      entradasUserIds: new Set(["ana"]),
      turnos: [turno("t1", "ana", "09:00", "17:00")],
      nowMinutos: 9 * 60 + 30,
    });
    expect(r).toHaveLength(0);
  });

  it("no avisa una vez terminado el turno", () => {
    const r = turnosOlvidados({
      ...base,
      turnos: [turno("t1", "ana", "09:00", "14:00")],
      nowMinutos: 15 * 60, // 15:00 > fin
    });
    expect(r).toHaveLength(0);
  });

  it("avisa solo a quien corresponde con varios turnos", () => {
    const r = turnosOlvidados({
      ...base,
      entradasUserIds: new Set(["leo"]),
      turnos: [
        turno("t1", "ana", "09:00", "17:00"),
        turno("t2", "leo", "09:00", "17:00"),
      ],
      nowMinutos: 10 * 60,
    });
    expect(r.map((t) => t.userId)).toEqual(["ana"]);
  });
});
