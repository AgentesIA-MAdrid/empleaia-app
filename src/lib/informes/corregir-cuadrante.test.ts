import { describe, it, expect } from "vitest";
import { planificarCorreccion } from "./corregir-cuadrante";

const TURNO = { id: "t_1", horaInicio: "10:00", horaFin: "17:00", sedeNombre: "NEKSUS CARTAGENA" };

describe("planificarCorreccion — ticket c1e94a7b", () => {
  it("sede distinta: cambia la sede del turno a la del fichaje", () => {
    const r = planificarCorreccion({
      tipo: "sede_distinta",
      turno: TURNO,
      fichaje: { tiendaId: "t_vaguada", sedeNombre: "YOIGO CC LA VAGUADA" },
    });
    expect(r).toEqual({
      ok: true,
      plan: {
        accion: "cambiar_sede",
        turnoId: "t_1",
        tiendaId: "t_vaguada",
        antes: "NEKSUS CARTAGENA 10:00-17:00",
        despues: "YOIGO CC LA VAGUADA 10:00-17:00",
      },
    });
  });

  it("fichó sin turno: crea el turno con las horas de sus fichajes", () => {
    const r = planificarCorreccion({
      tipo: "sin_turno",
      turno: null,
      fichaje: { tiendaId: "t_vaguada", sedeNombre: "YOIGO CC LA VAGUADA" },
      horasFichadas: { entrada: "09:50", salida: "17:20" },
    });
    expect(r).toMatchObject({
      ok: true,
      plan: {
        accion: "crear_turno",
        tiendaId: "t_vaguada",
        horaInicio: "09:50",
        horaFin: "17:20",
        antes: "sin turno en el cuadrante",
      },
    });
  });

  it("sin salida fichada aún, el turno se cierra con el horario de la sede", () => {
    const r = planificarCorreccion({
      tipo: "sin_turno",
      turno: null,
      fichaje: { tiendaId: "t_vaguada", sedeNombre: "Vaguada" },
      horasFichadas: { entrada: "09:50", salida: null },
      horarioSede: { apertura: "10:00", cierre: "22:00" },
    });
    expect(r).toMatchObject({ ok: true, plan: { horaInicio: "09:50", horaFin: "22:00" } });
  });

  it("sin salida y sin horario de sede, se pide ponerlo a mano en vez de inventar", () => {
    const r = planificarCorreccion({
      tipo: "sin_turno",
      turno: null,
      fichaje: { tiendaId: "t_vaguada", sedeNombre: "Vaguada" },
      horasFichadas: { entrada: "09:50", salida: null },
      horarioSede: null,
    });
    expect(r.ok).toBe(false);
  });

  it("turno sin fichaje: se marca no realizado, NO se borra", () => {
    const r = planificarCorreccion({ tipo: "turno_sin_fichaje", turno: TURNO, fichaje: null });
    expect(r).toEqual({
      ok: true,
      plan: {
        accion: "marcar_no_realizado",
        turnoId: "t_1",
        antes: "NEKSUS CARTAGENA 10:00-17:00",
        despues: "no realizado (sus horas no cuentan en el informe de horas)",
      },
    });
  });

  it("sin turno que corregir se dice, en vez de tocar otra cosa", () => {
    expect(planificarCorreccion({ tipo: "sede_distinta", turno: null, fichaje: null }).ok).toBe(false);
    expect(planificarCorreccion({ tipo: "turno_sin_fichaje", turno: null, fichaje: null }).ok).toBe(
      false,
    );
  });

  it("un fichaje sin sede no puede cuadrar nada", () => {
    const r = planificarCorreccion({
      tipo: "sede_distinta",
      turno: TURNO,
      fichaje: { tiendaId: null, sedeNombre: null },
    });
    expect(r.ok).toBe(false);
  });

  it("el antes y el después se guardan en texto, no por referencia", () => {
    // El turno se puede volver a tocar o la sede desaparecer: el historial tiene
    // que seguir contando lo que pasó.
    const r = planificarCorreccion({
      tipo: "sede_distinta",
      turno: TURNO,
      fichaje: { tiendaId: "t_x", sedeNombre: "Otra" },
    });
    expect(r.ok && typeof r.plan.antes).toBe("string");
    expect(r.ok && typeof r.plan.despues).toBe("string");
  });
});
