/**
 * Tests unit de getInformeData con prisma mockeado.
 *
 * Verifica:
 *  - Validación de tipo y fechas.
 *  - Filtrado por rol (OWNER/MANAGER/EMPLEADO).
 *  - Shape JSON exacto (no rompe contrato con /api/informes).
 *  - Caso vacío (tenant sin fichajes) no lanza.
 *  - presencia-global solo OWNER.
 */

import { describe, it, expect } from "vitest";
import { getInformeData } from "./queries";
import { Rol } from "@/generated/prisma-tenant/client";
import type { PrismaClient } from "@/generated/prisma-tenant/client";

type FakeFichaje = {
  id: string;
  userId: string;
  tipo: "ENTRADA" | "SALIDA" | "PAUSA" | "VUELTA_PAUSA";
  timestamp: Date;
  tiendaId: string | null;
  user?: unknown;
  tienda?: unknown;
};

function fakePrisma(rows: {
  fichajes?: FakeFichaje[];
  ausencias?: unknown[];
  turnos?: unknown[];
  users?: unknown[];
  tiendas?: unknown[];
  /** `ConfiguracionEmpresa` del tenant (jornada semanal por defecto). */
  config?: { horasSemanales: number } | null;
}): PrismaClient {
  return {
    configuracionEmpresa: {
      findFirst: async () => rows.config ?? null,
    },
    fichaje: {
      findMany: async () => rows.fichajes ?? [],
    },
    ausencia: {
      findMany: async () => rows.ausencias ?? [],
    },
    turno: {
      findMany: async () => rows.turnos ?? [],
    },
    user: {
      findMany: async () => rows.users ?? [],
    },
    tienda: {
      findMany: async () => rows.tiendas ?? [],
    },
  } as unknown as PrismaClient;
}

const BASE_ARGS = {
  fechaInicio: "2026-04-01",
  fechaFin: "2026-04-30",
  userRol: Rol.OWNER,
  userTiendaId: null,
  sessionUserId: "u_owner",
};

describe("getInformeData — validación", () => {
  it("tipo inválido → ok=false con status 400", async () => {
    const r = await getInformeData({
      ...BASE_ARGS,
      tipo: "xx" as never,
      prisma: fakePrisma({}),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.status).toBe(400);
    expect(r.error).toContain("tipo");
  });

  it("tipo fichajes sin fechas → ok=false con status 400", async () => {
    const r = await getInformeData({
      ...BASE_ARGS,
      tipo: "fichajes",
      fechaInicio: null,
      fechaFin: null,
      prisma: fakePrisma({}),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.status).toBe(400);
    expect(r.error).toContain("fechaInicio");
  });

  it("presencia sin fechas → ok (no requiere fechas)", async () => {
    const r = await getInformeData({
      ...BASE_ARGS,
      tipo: "presencia",
      fechaInicio: null,
      fechaFin: null,
      prisma: fakePrisma({ users: [], fichajes: [] }),
    });
    expect(r.ok).toBe(true);
  });

  it("presencia-global solo OWNER (MANAGER → 403)", async () => {
    const r = await getInformeData({
      ...BASE_ARGS,
      tipo: "presencia-global",
      userRol: Rol.MANAGER,
      prisma: fakePrisma({}),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.status).toBe(403);
  });
});

describe("getInformeData — shape JSON", () => {
  it("fichajes vacío devuelve { tipo, data: [], total: 0 }", async () => {
    const r = await getInformeData({
      ...BASE_ARGS,
      tipo: "fichajes",
      prisma: fakePrisma({ fichajes: [] }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data).toEqual({ tipo: "fichajes", data: [], total: 0 });
  });

  it("fichajes con datos preserva shape", async () => {
    const sample: FakeFichaje[] = [
      {
        id: "f1",
        userId: "u1",
        tipo: "ENTRADA",
        timestamp: new Date("2026-04-15T08:00:00Z"),
        tiendaId: "t1",
        user: { id: "u1", nombre: "Ana", apellidos: "G", email: "ana@x" },
        tienda: { id: "t1", nombre: "Sede" },
      },
    ];
    const r = await getInformeData({
      ...BASE_ARGS,
      tipo: "fichajes",
      prisma: fakePrisma({ fichajes: sample }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.tipo).toBe("fichajes");
    expect(r.data.total).toBe(1);
    expect(Array.isArray(r.data.data)).toBe(true);
  });

  it("resumen devuelve { tipo, empleados: [], stats, total: 0 } cuando no hay empleados", async () => {
    const r = await getInformeData({
      ...BASE_ARGS,
      tipo: "resumen",
      prisma: fakePrisma({ users: [], fichajes: [], ausencias: [] }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.tipo).toBe("resumen");
    expect(r.data.empleados).toEqual([]);
    expect(r.data.total).toBe(0);
    expect(r.data.stats).toMatchObject({ totalHoras: 0 });
  });

  // El periodo de BASE_ARGS (2026-04-01 → 2026-04-30) son 30 días naturales,
  // así que un contrato semanal de 35h prorratea a 35/7*30 = 150h.
  const jornadaDeUnDia: FakeFichaje[] = [
    {
      id: "f1",
      userId: "u1",
      tipo: "ENTRADA",
      timestamp: new Date("2026-04-15T08:00:00Z"),
      tiendaId: "t1",
    },
    {
      id: "f2",
      userId: "u1",
      tipo: "SALIDA",
      timestamp: new Date("2026-04-15T16:00:00Z"),
      tiendaId: "t1",
    },
  ];

  it("resumen compara las horas contra el contrato del empleado", async () => {
    const r = await getInformeData({
      ...BASE_ARGS,
      tipo: "resumen",
      prisma: fakePrisma({
        users: [{ id: "u1", nombre: "Ana", apellidos: "G", email: "a@x", horasSemanalesContrato: 35, tienda: null }],
        fichajes: jornadaDeUnDia,
        ausencias: [],
        config: { horasSemanales: 40 },
      }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    const [e] = r.data.empleados as {
      horasTotales: number; horasContrato: number; diferencia: number; horasExtra: number;
    }[];
    expect(e.horasTotales).toBe(8);
    expect(e.horasContrato).toBe(150);
    expect(e.diferencia).toBe(-142);
    // Por debajo del contrato no hay horas extra (antes se calculaban con una
    // jornada fija de 8h/día trabajado, que ignoraba el contrato).
    expect(e.horasExtra).toBe(0);
    expect(r.data.stats).toMatchObject({ horasContrato: 150, diferencia: -142, horasExtra: 0 });
  });

  it("resumen usa la jornada de la empresa si el empleado no tiene contrato", async () => {
    const r = await getInformeData({
      ...BASE_ARGS,
      tipo: "resumen",
      prisma: fakePrisma({
        users: [{ id: "u1", nombre: "Ana", apellidos: "G", email: "a@x", horasSemanalesContrato: null, tienda: null }],
        fichajes: jornadaDeUnDia,
        ausencias: [],
        config: { horasSemanales: 1.4 },
      }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    const [e] = r.data.empleados as { horasContrato: number; horasExtra: number }[];
    // 1,4 h/semana → 6h en 30 días; con 8h fichadas hay 2h de exceso.
    expect(e.horasContrato).toBe(6);
    expect(e.horasExtra).toBe(2);
  });

  it("turnos preserva tipo", async () => {
    const r = await getInformeData({
      ...BASE_ARGS,
      tipo: "turnos",
      prisma: fakePrisma({ turnos: [] }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.tipo).toBe("turnos");
    expect(r.data.total).toBe(0);
  });

  it("presencia-global como OWNER devuelve { tiendas, stats }", async () => {
    const r = await getInformeData({
      ...BASE_ARGS,
      tipo: "presencia-global",
      prisma: fakePrisma({ tiendas: [], fichajes: [], ausencias: [] }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.tiendas).toEqual([]);
    expect(r.data.stats).toMatchObject({ totalTiendas: 0 });
  });
});
