/**
 * Ticket 25c81b6b — fichar solo dentro del horario del cuadrante.
 *
 * Comprueba la decisión pura: cuándo el fichaje está dentro de la ventana
 * admitida, cuándo queda antes/después, a qué hora se ajustaría y qué pasa
 * con jornadas partidas y turnos de noche.
 */

import { describe, it, expect } from "vitest";
import {
  evaluarHorarioTurno,
  hhmmToMin,
  minToHHMM,
  partesEnZona,
  diffDias,
  instanteEnZona,
  type TurnoDia,
} from "@/lib/fichajes/horario-turno";

const MANANA: TurnoDia = { horaInicio: "09:00", horaFin: "17:00", offsetDias: 0 };

describe("evaluarHorarioTurno", () => {
  it("sin turnos publicados no comprueba nada", () => {
    expect(evaluarHorarioTurno({ turnos: [], ahoraMin: 60, margenMin: 15 })).toEqual({
      estado: "sin_turno",
    });
  });

  it("dentro del turno admite el fichaje", () => {
    const r = evaluarHorarioTurno({ turnos: [MANANA], ahoraMin: hhmmToMin("12:30"), margenMin: 15 });
    expect(r.estado).toBe("dentro");
  });

  it("dentro del margen de cortesía (antes y después) admite el fichaje", () => {
    const antes = evaluarHorarioTurno({ turnos: [MANANA], ahoraMin: hhmmToMin("08:50"), margenMin: 15 });
    const despues = evaluarHorarioTurno({ turnos: [MANANA], ahoraMin: hhmmToMin("17:10"), margenMin: 15 });
    expect(antes.estado).toBe("dentro");
    expect(despues.estado).toBe("dentro");
  });

  it("demasiado pronto: fuera, y se ajustaría al inicio del turno", () => {
    const r = evaluarHorarioTurno({ turnos: [MANANA], ahoraMin: hhmmToMin("07:40"), margenMin: 15 });
    expect(r.estado).toBe("fuera");
    if (r.estado !== "fuera") return;
    expect(r.motivo).toBe("antes");
    expect(minToHHMM(r.ajusteMin)).toBe("09:00");
  });

  it("demasiado tarde: fuera, y se ajustaría al fin del turno", () => {
    const r = evaluarHorarioTurno({ turnos: [MANANA], ahoraMin: hhmmToMin("18:20"), margenMin: 15 });
    expect(r.estado).toBe("fuera");
    if (r.estado !== "fuera") return;
    expect(r.motivo).toBe("despues");
    expect(minToHHMM(r.ajusteMin)).toBe("17:00");
  });

  it("margen 0 rechaza el minuto anterior al turno", () => {
    const r = evaluarHorarioTurno({ turnos: [MANANA], ahoraMin: hhmmToMin("08:59"), margenMin: 0 });
    expect(r.estado).toBe("fuera");
  });

  it("jornada partida: vale cualquiera de los dos tramos", () => {
    const turnos: TurnoDia[] = [
      { horaInicio: "09:00", horaFin: "13:00", offsetDias: 0 },
      { horaInicio: "17:00", horaFin: "21:00", offsetDias: 0 },
    ];
    expect(evaluarHorarioTurno({ turnos, ahoraMin: hhmmToMin("18:00"), margenMin: 15 }).estado).toBe("dentro");
    // Entre los dos tramos está fuera: se ajusta al más cercano (el de tarde).
    const r = evaluarHorarioTurno({ turnos, ahoraMin: hhmmToMin("15:30"), margenMin: 15 });
    expect(r.estado).toBe("fuera");
    if (r.estado !== "fuera") return;
    expect(r.motivo).toBe("antes");
    expect(minToHHMM(r.ajusteMin)).toBe("17:00");
  });

  it("turno de noche: la madrugada siguiente sigue siendo su turno", () => {
    // Noches consecutivas: el de ayer 22:00–06:00 y otro igual hoy.
    const turnos: TurnoDia[] = [
      { horaInicio: "22:00", horaFin: "06:00", offsetDias: -1 },
      { horaInicio: "22:00", horaFin: "06:00", offsetDias: 0 },
    ];
    // 05:30 de hoy = dentro del turno que empezó ayer a las 22:00.
    expect(evaluarHorarioTurno({ turnos, ahoraMin: hhmmToMin("05:30"), margenMin: 15 }).estado)
      .toBe("dentro");
    const r = evaluarHorarioTurno({ turnos, ahoraMin: hhmmToMin("07:00"), margenMin: 15 });
    expect(r.estado).toBe("fuera");
    if (r.estado !== "fuera") return;
    expect(r.motivo).toBe("despues");
    // Se ajusta al fin del turno que venía de ayer: las 06:00 de HOY.
    expect(r.turno.offsetDias).toBe(-1);
    expect(r.ajusteMin).toBe(hhmmToMin("06:00"));
    expect(minToHHMM(r.ajusteMin)).toBe("06:00");
  });

  it("sin turno hoy no comprueba nada, aunque haya turno ayer o mañana", () => {
    // El turno de ayer/mañana solo está en la lista por los turnos que cruzan
    // medianoche: si hoy no hay cuadrante, no puede rechazar el fichaje.
    const ayer: TurnoDia = { horaInicio: "09:00", horaFin: "17:00", offsetDias: -1 };
    const manana: TurnoDia = { horaInicio: "09:00", horaFin: "17:00", offsetDias: 1 };
    expect(evaluarHorarioTurno({ turnos: [ayer], ahoraMin: hhmmToMin("09:50"), margenMin: 15 }))
      .toEqual({ estado: "sin_turno" });
    expect(evaluarHorarioTurno({ turnos: [manana], ahoraMin: hhmmToMin("09:50"), margenMin: 15 }))
      .toEqual({ estado: "sin_turno" });
    expect(evaluarHorarioTurno({ turnos: [ayer, manana], ahoraMin: hhmmToMin("21:00"), margenMin: 15 }))
      .toEqual({ estado: "sin_turno" });
  });

  it("el turno de ayer que ya terminó no decide el ajuste de hoy", () => {
    const turnos: TurnoDia[] = [
      { horaInicio: "09:00", horaFin: "17:00", offsetDias: -1 },
      { horaInicio: "09:00", horaFin: "17:00", offsetDias: 0 },
    ];
    const r = evaluarHorarioTurno({ turnos, ahoraMin: hhmmToMin("07:00"), margenMin: 15 });
    expect(r.estado).toBe("fuera");
    if (r.estado !== "fuera") return;
    // Se ajusta al inicio del turno de hoy, no al fin del de ayer.
    expect(r.motivo).toBe("antes");
    expect(r.turno.offsetDias).toBe(0);
    expect(r.ajusteMin).toBe(hhmmToMin("09:00"));
  });

  it("turno de mañana: fichar de madrugada queda 'antes'", () => {
    const r = evaluarHorarioTurno({ turnos: [MANANA], ahoraMin: hhmmToMin("02:00"), margenMin: 15 });
    expect(r.estado).toBe("fuera");
    if (r.estado !== "fuera") return;
    expect(r.motivo).toBe("antes");
  });
});

describe("helpers de zona horaria", () => {
  it("partesEnZona lee el día y el minuto en la zona del tenant", () => {
    // 2026-07-31T21:30:00Z = 23:30 en Madrid (verano, UTC+2).
    const p = partesEnZona(new Date("2026-07-31T21:30:00Z"), "Europe/Madrid");
    expect(p.fecha).toBe("2026-07-31");
    expect(p.minutos).toBe(hhmmToMin("23:30"));
  });

  it("partesEnZona cruza al día siguiente cuando toca", () => {
    const p = partesEnZona(new Date("2026-07-31T22:30:00Z"), "Europe/Madrid");
    expect(p.fecha).toBe("2026-08-01");
    expect(p.minutos).toBe(hhmmToMin("00:30"));
  });

  it("diffDias cuenta días de calendario", () => {
    expect(diffDias("2026-07-31", "2026-08-01")).toBe(1);
    expect(diffDias("2026-07-31", "2026-07-30")).toBe(-1);
    expect(diffDias("2026-07-31", "2026-07-31")).toBe(0);
  });

  it("instanteEnZona convierte hora local a instante real (verano e invierno)", () => {
    expect(instanteEnZona("2026-07-31", hhmmToMin("09:00"), "Europe/Madrid").toISOString())
      .toBe("2026-07-31T07:00:00.000Z");
    expect(instanteEnZona("2026-01-15", hhmmToMin("09:00"), "Europe/Madrid").toISOString())
      .toBe("2026-01-15T08:00:00.000Z");
  });

  it("instanteEnZona admite minutos del día siguiente (turno de noche)", () => {
    // 06:00 del día siguiente = 1440 + 360 minutos.
    expect(instanteEnZona("2026-07-31", 1440 + hhmmToMin("06:00"), "Europe/Madrid").toISOString())
      .toBe("2026-08-01T04:00:00.000Z");
  });
});
