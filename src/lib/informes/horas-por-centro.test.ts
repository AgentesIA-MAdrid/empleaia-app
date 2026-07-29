import { describe, it, expect } from "vitest";
import {
  agregarHorasPorCentro,
  agregarHorasCuadrantePorCentro,
  calcularHorasPorCentroCuadrante,
  enriquecerConContrato,
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

  it("cuenta el turno que cruza medianoche como 8h", () => {
    const filas = agregarHorasCuadrantePorCentro([
      turno("sam", "Sam", "A", "Sede A", { horaInicio: "22:00", horaFin: "06:00" }),
    ]);
    expect(filas[0].horas).toBe(8);
    expect(filas[0].centro).toBe("Sede A");
  });
});

describe("enriquecerConContrato", () => {
  const fila = (userId: string, tiendaId: string, minutos: number) => ({
    userId,
    empleado: `${userId} X`,
    tiendaId,
    centro: `Sede ${tiendaId}`,
    minutos,
    horas: Math.round((minutos / 60) * 100) / 100,
  });

  it("reparte el mismo contrato y diferencia en todas las sedes del empleado", () => {
    // Ana: 20h en A + 25h en B = 45h, contrato 40h/semana en 7 días.
    const filas = enriquecerConContrato([fila("ana", "A", 1200), fila("ana", "B", 1500)], {
      horasSemanalesPorUsuario: new Map([["ana", 40]]),
      horasSemanalesEmpresa: 38,
      dias: 7,
    });
    expect(filas.map((f) => f.horas)).toEqual([20, 25]);
    // El contrato es de la persona, no de la sede: no puede pedirse entero
    // en cada una. Total y diferencia se repiten iguales en ambas filas.
    for (const f of filas) {
      expect(f.horasTotales).toBe(45);
      expect(f.horasContrato).toBe(40);
      expect(f.diferencia).toBe(5);
    }
  });

  it("usa la jornada de la empresa cuando el empleado no tiene contrato", () => {
    const [f] = enriquecerConContrato([fila("leo", "A", 600)], {
      horasSemanalesPorUsuario: new Map([["leo", null]]),
      horasSemanalesEmpresa: 35,
      dias: 7,
    });
    expect(f.horasContrato).toBe(35);
    expect(f.diferencia).toBe(-25);
  });

  it("mide el contrato contra las horas globales cuando el informe va filtrado por sede", () => {
    // Filtrado a la sede A (10h), pero la persona hace otras 30h en B.
    const [f] = enriquecerConContrato([fila("sam", "A", 600)], {
      horasSemanalesPorUsuario: new Map([["sam", 40]]),
      horasSemanalesEmpresa: 40,
      dias: 7,
      filasGlobales: [fila("sam", "A", 600), fila("sam", "B", 1800)],
    });
    expect(f.horas).toBe(10);
    expect(f.horasTotales).toBe(40);
    expect(f.diferencia).toBe(0);
  });
});

describe("calcularHorasPorCentroCuadrante — filtros de la consulta", () => {
  /** Doble de Prisma que solo captura los argumentos de findMany. */
  function prismaEspia() {
    const capturado: { args?: Record<string, unknown> } = {};
    const prisma = {
      turno: {
        findMany: (args: Record<string, unknown>) => {
          capturado.args = args;
          return Promise.resolve([]);
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { prisma: prisma as any, capturado };
  }

  it("excluye a los empleados dados de baja (ticket #65)", async () => {
    const { prisma, capturado } = prismaEspia();
    await calcularHorasPorCentroCuadrante({
      prisma,
      fechaInicio: new Date("2026-07-01T00:00:00Z"),
      fechaFin: new Date("2026-07-31T23:59:59Z"),
    });
    // Un empleado de baja conserva turnos planificados de sus últimos días:
    // sin este filtro el informe los sumaba como horas de quien ya no está.
    const where = capturado.args?.where as { user?: { activo?: boolean } };
    expect(where.user).toEqual({ activo: true });
  });

  it("respeta el filtro de sede cuando se pasa", async () => {
    const { prisma, capturado } = prismaEspia();
    await calcularHorasPorCentroCuadrante({
      prisma,
      fechaInicio: new Date("2026-07-01T00:00:00Z"),
      fechaFin: new Date("2026-07-31T23:59:59Z"),
      tiendaId: "t1",
    });
    const where = capturado.args?.where as { tiendaId?: string };
    expect(where.tiendaId).toBe("t1");
  });

  it("acepta rangos futuros: el cuadrante se planifica a futuro (ticket #64)", async () => {
    const { prisma, capturado } = prismaEspia();
    const finFuturo = new Date("2099-12-31T23:59:59Z");
    await calcularHorasPorCentroCuadrante({
      prisma,
      fechaInicio: new Date("2099-12-01T00:00:00Z"),
      fechaFin: finFuturo,
    });
    const where = capturado.args?.where as { fecha?: { lte?: Date } };
    expect(where.fecha?.lte).toEqual(finFuturo);
  });
});
