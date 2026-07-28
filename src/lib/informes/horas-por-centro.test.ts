import { describe, it, expect } from "vitest";
import {
  agregarHorasPorCentro,
  agregarHorasCuadrantePorCentro,
} from "./horas-por-centro";

const u = (nombre: string) => ({ nombre, apellidos: "X" });

describe("agregarHorasPorCentro", () => {
  it("suma minutos por empleado y centro, atribuyendo a la sede de la entrada", () => {
    const t = (h: number, m = 0) => new Date(2026, 5, 1, h, m);
    const filas = agregarHorasPorCentro([
      // Ana: 09–13 en sede A, 14–18 en sede B.
      { userId: "ana", tiendaId: "A", tipo: "ENTRADA", timestamp: t(9), user: u("Ana"), tienda: { nombre: "Sede A" } },
      { userId: "ana", tiendaId: "A", tipo: "SALIDA", timestamp: t(13), user: u("Ana"), tienda: { nombre: "Sede A" } },
      { userId: "ana", tiendaId: "B", tipo: "ENTRADA", timestamp: t(14), user: u("Ana"), tienda: { nombre: "Sede B" } },
      { userId: "ana", tiendaId: "B", tipo: "SALIDA", timestamp: t(18), user: u("Ana"), tienda: { nombre: "Sede B" } },
    ]);
    expect(filas).toHaveLength(2);
    const a = filas.find((f) => f.tiendaId === "A")!;
    const b = filas.find((f) => f.tiendaId === "B")!;
    expect(a.horas).toBe(4);
    expect(b.horas).toBe(4);
    expect(a.empleado).toBe("Ana X");
    expect(a.centro).toBe("Sede A");
  });

  it("cuenta las pausas como cortes (no suma el tiempo de pausa)", () => {
    const t = (h: number, m = 0) => new Date(2026, 5, 1, h, m);
    const filas = agregarHorasPorCentro([
      { userId: "leo", tiendaId: "A", tipo: "ENTRADA", timestamp: t(9), user: u("Leo"), tienda: { nombre: "A" } },
      { userId: "leo", tiendaId: "A", tipo: "PAUSA", timestamp: t(11), user: u("Leo"), tienda: { nombre: "A" } },
      { userId: "leo", tiendaId: "A", tipo: "VUELTA_PAUSA", timestamp: t(12), user: u("Leo"), tienda: { nombre: "A" } },
      { userId: "leo", tiendaId: "A", tipo: "SALIDA", timestamp: t(14), user: u("Leo"), tienda: { nombre: "A" } },
    ]);
    // 2h (9–11) + 2h (12–14) = 4h; la hora de pausa no cuenta.
    expect(filas).toHaveLength(1);
    expect(filas[0].horas).toBe(4);
  });

  it("agrupa los fichajes sin sede como 'Sin sede'", () => {
    const t = (h: number) => new Date(2026, 5, 1, h, 0);
    const filas = agregarHorasPorCentro([
      { userId: "sam", tiendaId: null, tipo: "ENTRADA", timestamp: t(8), user: u("Sam"), tienda: null },
      { userId: "sam", tiendaId: null, tipo: "SALIDA", timestamp: t(10), user: u("Sam"), tienda: null },
    ]);
    expect(filas[0].centro).toBe("Sin sede");
    expect(filas[0].horas).toBe(2);
  });
});

describe("agregarHorasCuadrantePorCentro", () => {
  const turno = (
    userId: string,
    nombre: string,
    tiendaId: string,
    centro: string,
    extra: Record<string, unknown>,
  ) => ({
    userId,
    tiendaId,
    // Día por defecto del turno (medianoche UTC, como se guarda en BD).
    fecha: "2026-07-01T00:00:00.000Z",
    user: u(nombre),
    tienda: { nombre: centro },
    ...extra,
  });

  it("suma las horas del tipo de turno por empleado y centro", () => {
    const filas = agregarHorasCuadrantePorCentro([
      // Ana: 2 mañanas (6h) en Sede A y 1 tarde (7h) en Sede B.
      turno("ana", "Ana", "A", "Sede A", { tipoTurno: { horas: 6 } }),
      turno("ana", "Ana", "A", "Sede A", { tipoTurno: { horas: "6" } }),
      turno("ana", "Ana", "B", "Sede B", { tipoTurno: { horas: 7 } }),
    ]);
    expect(filas).toHaveLength(2);
    expect(filas.find((f) => f.tiendaId === "A")!.horas).toBe(12);
    expect(filas.find((f) => f.tiendaId === "B")!.horas).toBe(7);
    expect(filas[0].empleado).toBe("Ana X");
  });

  it("cae al rango horario cuando el tipo no fija horas y suma 0 en LIBRE", () => {
    const filas = agregarHorasCuadrantePorCentro([
      turno("leo", "Leo", "A", "Sede A", { horaInicio: "09:00", horaFin: "13:30" }),
      turno("leo", "Leo", "A", "Sede A", {
        tipoTurno: { esLibre: true, horas: 0 },
        horaInicio: "00:00",
        horaFin: "00:00",
      }),
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0].horas).toBe(4.5);
  });

  it("no cuenta los turnos que caen en una ausencia aprobada", () => {
    const filas = agregarHorasCuadrantePorCentro(
      [
        // Día de vacaciones con un turno viejo debajo: no computa.
        turno("yesy", "Yesy", "A", "Sede A", {
          fecha: "2026-07-07T00:00:00.000Z",
          horaInicio: "09:00",
          horaFin: "15:00",
        }),
        // Fuera de la ausencia: sí computa.
        turno("yesy", "Yesy", "A", "Sede A", {
          fecha: "2026-07-15T00:00:00.000Z",
          horaInicio: "09:00",
          horaFin: "13:00",
        }),
      ],
      [{ userId: "yesy", fechaInicio: "2026-07-06T00:00:00.000Z", fechaFin: "2026-07-10T00:00:00.000Z" }],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].horas).toBe(4);
  });

  it("deja fuera del informe a quien solo tiene turnos en días de ausencia", () => {
    const filas = agregarHorasCuadrantePorCentro(
      [
        turno("yesy", "Yesy", "A", "Sede A", {
          fecha: "2026-07-07T00:00:00.000Z",
          horaInicio: "09:00",
          horaFin: "15:00",
        }),
        turno("ana", "Ana", "A", "Sede A", { tipoTurno: { horas: 6 } }),
      ],
      [{ userId: "yesy", fechaInicio: "2026-07-06T00:00:00.000Z", fechaFin: "2026-07-10T00:00:00.000Z" }],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].empleado).toBe("Ana X");
    expect(filas[0].horas).toBe(6);
  });

  it("cuenta el turno que cruza medianoche como 8h", () => {
    const filas = agregarHorasCuadrantePorCentro([
      turno("sam", "Sam", "A", "Sede A", { horaInicio: "22:00", horaFin: "06:00" }),
    ]);
    expect(filas[0].horas).toBe(8);
    expect(filas[0].centro).toBe("Sede A");
  });
});
