import { describe, it, expect } from "vitest";
import { agruparPendientesPorSede, describirPendiente, decidirAviso, diaARevisar } from "./vigilancia";

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

describe("decidirAviso — a qué cliente le toca en esta ejecución", () => {
  const base = { activo: true, hora: 23, zona: "Europe/Madrid", ultimoDia: null };

  it("le toca cuando su hora local coincide", () => {
    // 21:15 UTC = 23:15 en Madrid (CEST).
    const d = decidirAviso(base, new Date("2026-07-30T21:15:00Z"));
    expect(d).toEqual({ toca: true, dia: "2026-07-30", motivo: "toca" });
  });

  it("no le toca a otra hora", () => {
    const d = decidirAviso(base, new Date("2026-07-30T15:00:00Z"));
    expect(d.toca).toBe(false);
    expect(d.motivo).toBe("otra_hora");
  });

  it("respeta la zona del cliente: Canarias va una hora por detrás", () => {
    // 22:30 UTC = 23:30 en Canarias, pero 00:30 del día siguiente en Madrid.
    const canarias = decidirAviso({ ...base, zona: "Atlantic/Canary" }, new Date("2026-07-30T22:30:00Z"));
    expect(canarias).toEqual({ toca: true, dia: "2026-07-30", motivo: "toca" });

    const madrid = decidirAviso(base, new Date("2026-07-30T22:30:00Z"));
    expect(madrid.toca).toBe(false);
  });

  it("una tienda que cierra a medianoche avisa a las 00:00 del día siguiente", () => {
    const d = decidirAviso({ ...base, hora: 0 }, new Date("2026-07-30T22:10:00Z"));
    expect(d).toEqual({ toca: true, dia: "2026-07-31", motivo: "toca" });
  });

  it("no repite el aviso el mismo día aunque el cron se ejecute dos veces", () => {
    const d = decidirAviso({ ...base, ultimoDia: "2026-07-30" }, new Date("2026-07-30T21:15:00Z"));
    expect(d.toca).toBe(false);
    expect(d.motivo).toBe("ya_avisado");
  });

  it("desactivado no avisa aunque sea su hora", () => {
    const d = decidirAviso({ ...base, activo: false }, new Date("2026-07-30T21:15:00Z"));
    expect(d.motivo).toBe("desactivado");
  });

  it("una hora fuera de rango cae en las 23:00 en vez de no avisar nunca", () => {
    expect(decidirAviso({ ...base, hora: 99 }, new Date("2026-07-30T21:15:00Z")).toca).toBe(true);
    expect(decidirAviso({ ...base, hora: -3 }, new Date("2026-07-30T21:15:00Z")).toca).toBe(true);
  });

  it("una zona mal escrita no rompe el cron", () => {
    const d = decidirAviso({ ...base, zona: "Marte/Olympus" }, new Date("2026-07-30T21:15:00Z"));
    expect(d.toca).toBe(false);
    expect(d.motivo).toBe("zona_invalida");
  });
});

describe("diaARevisar", () => {
  it("con aviso de tarde o noche, el día en curso", () => {
    expect(diaARevisar("2026-07-30", 23)).toBe("2026-07-30");
    expect(diaARevisar("2026-07-30", 14)).toBe("2026-07-30");
  });

  it("con aviso de madrugada, la jornada que acaba de terminar", () => {
    // Una tienda que cierra a medianoche avisa a las 00:00 del 31, pero lo que
    // hay que revisar es el turno del 30: el 31 aún no ha fichado nadie.
    expect(diaARevisar("2026-07-31", 0)).toBe("2026-07-30");
    expect(diaARevisar("2026-07-31", 2)).toBe("2026-07-30");
  });

  it("cruza bien el cambio de mes", () => {
    expect(diaARevisar("2026-08-01", 1)).toBe("2026-07-31");
  });

  it("cruza bien el cambio de año", () => {
    expect(diaARevisar("2027-01-01", 0)).toBe("2026-12-31");
  });
});
