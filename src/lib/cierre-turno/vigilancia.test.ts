import { describe, it, expect } from "vitest";
import { agruparPendientesPorSede, describirPendiente } from "./vigilancia";

const turno = (userId: string, nombre: string, tiendaId: string | null = "t1", tiendaNombre: string | null = "Centro") => ({
  userId,
  nombre,
  tiendaId,
  tiendaNombre,
});

const cierreCompleto = (userId: string) => ({
  userId,
  ventas: 3,
  detalleJornada: "Jornada normal",
  cajaConfirmada: true,
  completadoEn: new Date("2026-07-30T20:00:00Z"),
});

describe("agruparPendientesPorSede", () => {
  it("no reclama a quien ha cerrado", () => {
    const r = agruparPendientesPorSede([turno("u1", "Marta")], [cierreCompleto("u1")]);
    expect(r).toEqual([]);
  });

  it("solo reclama a quien tenía turno", () => {
    // Sin este filtro, cualquier día libre generaría una reclamación falsa y
    // el aviso acabaría en la carpeta de ignorados.
    const r = agruparPendientesPorSede([], [
      { userId: "u9", ventas: 0, detalleJornada: null, cajaConfirmada: false, completadoEn: null },
    ]);
    expect(r).toEqual([]);
  });

  it("marca a quien no ha empezado", () => {
    const r = agruparPendientesPorSede([turno("u1", "Marta")], []);
    expect(r).toHaveLength(1);
    expect(r[0].personas[0]).toMatchObject({ nombre: "Marta", sinEmpezar: true });
    expect(r[0].personas[0].pasos).toEqual(["ventas", "caja", "incidencias"]);
  });

  it("detalla qué le falta a quien lo dejó a medias", () => {
    const r = agruparPendientesPorSede(
      [turno("u1", "Marta")],
      [{ userId: "u1", ventas: 4, detalleJornada: "Dos altas", cajaConfirmada: false, completadoEn: null }],
    );
    expect(r[0].personas[0]).toMatchObject({ sinEmpezar: false });
    expect(r[0].personas[0].pasos).toEqual(["caja", "incidencias"]);
  });

  it("agrupa por sede y ordena alfabéticamente", () => {
    const r = agruparPendientesPorSede(
      [
        turno("u1", "Marta", "t2", "Norte"),
        turno("u2", "Luis", "t1", "Centro"),
        turno("u3", "Ana", "t1", "Centro"),
      ],
      [],
    );
    expect(r.map((s) => s.tiendaNombre)).toEqual(["Centro", "Norte"]);
    expect(r[0].personas.map((p) => p.nombre)).toEqual(["Luis", "Ana"]);
  });

  it("una sede al día no aparece en el aviso", () => {
    const r = agruparPendientesPorSede(
      [turno("u1", "Marta", "t1", "Centro"), turno("u2", "Luis", "t2", "Norte")],
      [cierreCompleto("u1")],
    );
    expect(r).toHaveLength(1);
    expect(r[0].tiendaNombre).toBe("Norte");
  });

  it("quien no tiene sede se agrupa aparte, sin perderse", () => {
    const r = agruparPendientesPorSede([turno("u1", "Marta", null, null)], []);
    expect(r[0].tiendaNombre).toBe("Sin sede asignada");
    expect(r[0].tiendaId).toBeNull();
  });
});

describe("describirPendiente", () => {
  it("dice claramente que no ha empezado", () => {
    expect(describirPendiente({ userId: "u1", nombre: "Marta", pasos: ["ventas"], sinEmpezar: true })).toBe(
      "Marta — no ha empezado el cierre",
    );
  });

  it("enumera los pasos que faltan con nombres de persona, no de código", () => {
    expect(
      describirPendiente({ userId: "u1", nombre: "Luis", pasos: ["caja", "incidencias"], sinEmpezar: false }),
    ).toBe("Luis — le falta: cierre de caja, cerrar el turno");
  });
});
