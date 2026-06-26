import { describe, it, expect } from "vitest";
import { agregarHorasPorCentro } from "./horas-por-centro";

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
