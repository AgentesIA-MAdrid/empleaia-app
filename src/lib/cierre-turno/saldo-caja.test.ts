import { describe, it, expect } from "vitest";
import {
  acumuladoEnCaja,
  desdeCuandoCuentan,
  diferenciaSaldo,
  type ArranqueCaja,
} from "./saldo-caja";

const ARRANQUE = (importe: number | null, incidencia: string | null = null): ArranqueCaja => ({
  fecha: new Date("2026-07-31T00:00:00Z"),
  importe,
  incidencia,
});

describe("acumuladoEnCaja — ticket 5f0a92c7", () => {
  it("parte de lo que ya había y le suma lo cobrado", () => {
    // Cartagena estrena el sistema con 239,32 € ya acumulados en el cajón.
    const r = acumuladoEnCaja({ arranque: ARRANQUE(239.32), cobrado: 480 });
    expect(r.esperado).toBe(719.32);
    expect(r).toMatchObject({ arranque: 239.32, cobrado: 480, motivo: null });
  });

  it("tras un arqueo, la caja arranca de cero y solo cuenta lo nuevo", () => {
    // El domingo el acumulado se va al sobre y queda 0 registrado.
    const r = acumuladoEnCaja({ arranque: ARRANQUE(0), cobrado: 315.4 });
    expect(r.esperado).toBe(315.4);
  });

  it("un arranque negativo es un arranque: falta dinero y la cuenta lo dice", () => {
    // Alcorcón C Mayor entró con −4,48 €. Tratarlo como 0 escondería el agujero.
    const r = acumuladoEnCaja({ arranque: ARRANQUE(-4.48), cobrado: 100 });
    expect(r.esperado).toBe(95.52);
  });

  it("sin arranque registrado no se inventa un cero", () => {
    const r = acumuladoEnCaja({ arranque: null, cobrado: 480 });
    expect(r.esperado).toBeNull();
    expect(r.motivo).toBe("sin_arranque");
    // Lo cobrado se sigue dando: es información buena aunque falte el arranque.
    expect(r.cobrado).toBe(480);
  });

  it("un arranque en incidencia tampoco vale como cero", () => {
    // Isla Azul y Plaza de la Estación se cargaron sin importe a propósito.
    const r = acumuladoEnCaja({
      arranque: ARRANQUE(null, "Caja pendiente de aclarar: sin fondo fiable a esta fecha."),
      cobrado: 300,
    });
    expect(r.esperado).toBeNull();
    expect(r.motivo).toBe("arranque_en_incidencia");
  });

  it("los céntimos no se van sumando solos", () => {
    const r = acumuladoEnCaja({ arranque: ARRANQUE(0.1), cobrado: 0.2 });
    expect(r.esperado).toBe(0.3);
  });
});

describe("diferenciaSaldo", () => {
  it("positiva cuando sobra dinero y negativa cuando falta", () => {
    expect(diferenciaSaldo(725, 719.32)).toBe(5.68);
    expect(diferenciaSaldo(700, 719.32)).toBe(-19.32);
    expect(diferenciaSaldo(719.32, 719.32)).toBe(0);
  });

  it("sin acumulado calculable no hay diferencia, que no es lo mismo que cuadrar", () => {
    // Devolver 0 aquí pintaría de verde una caja que nadie ha podido comprobar.
    expect(diferenciaSaldo(500, null)).toBeNull();
  });
});

describe("desdeCuandoCuentan", () => {
  it("los cobros cuentan desde el día SIGUIENTE al del arranque", () => {
    // El arranque es el saldo al cerrar el 31; lo cobrado ese día ya está dentro.
    // Contarlo otra vez duplicaría la caja del último día.
    expect(desdeCuandoCuentan(ARRANQUE(239.32)).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("cruza el fin de año sin despeinarse", () => {
    const finDeAnio: ArranqueCaja = {
      fecha: new Date("2026-12-31T00:00:00Z"),
      importe: 10,
      incidencia: null,
    };
    expect(desdeCuandoCuentan(finDeAnio).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
