import { describe, it, expect } from "vitest";
import { DIAS_TRABAJO_RECIENTE, ventanasDeTrabajo } from "./sedes-operables";

/**
 * Los periodos en los que se mira dónde trabaja alguien (ticket 225e527c).
 *
 * El sobre del arqueo es de la sede, así que lo ve quien trabaja allí: su
 * cuadrante, sus fichajes y sus cierres. "Allí" tiene que estar acotado en el
 * tiempo —haber cubierto un día no da acceso a esa caja para siempre— y a la
 * vez llegar a la semana del sobre que se está mirando, que puede ser vieja.
 */
describe("ventanasDeTrabajo", () => {
  const hoy = new Date("2026-08-06T00:00:00Z"); // jueves de la semana 2026-W32

  it("sin más periodos, mira las últimas ocho semanas y lo que queda de esta", () => {
    const [reciente, ...resto] = ventanasDeTrabajo(hoy);
    expect(resto).toEqual([]);
    expect(reciente.desde.toISOString().slice(0, 10)).toBe("2026-06-11");
    expect(
      Math.round((hoy.getTime() - reciente.desde.getTime()) / 86_400_000),
    ).toBe(DIAS_TRABAJO_RECIENTE);
    // Hasta el domingo de esta semana: el cuadrante de los días que quedan
    // también dice dónde trabaja.
    expect(reciente.hasta.toISOString().slice(0, 10)).toBe("2026-08-09");
  });

  it("añade la semana del arqueo cuando queda fuera del periodo reciente", () => {
    const semanaVieja = { desde: new Date("2026-03-02T00:00:00Z"), hasta: new Date("2026-03-08T00:00:00Z") };
    const ventanas = ventanasDeTrabajo(hoy, [semanaVieja]);
    expect(ventanas).toHaveLength(2);
    expect(ventanas[1]).toEqual(semanaVieja);
  });

  it("no repite la semana si ya cae dentro del periodo reciente", () => {
    const semanaPasada = { desde: new Date("2026-07-27T00:00:00Z"), hasta: new Date("2026-08-02T00:00:00Z") };
    expect(ventanasDeTrabajo(hoy, [semanaPasada])).toHaveLength(1);
  });

  it("varios sobres de la misma semana vieja no multiplican periodos", () => {
    const semana = { desde: new Date("2026-03-02T00:00:00Z"), hasta: new Date("2026-03-08T00:00:00Z") };
    const ventanas = ventanasDeTrabajo(hoy, [semana, { ...semana }]);
    expect(ventanas).toHaveLength(2);
  });
});
