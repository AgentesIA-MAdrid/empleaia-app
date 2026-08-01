import { describe, it, expect } from "vitest";
import { fusionarVentas } from "./ventas-queries";


/**
 * Cubrir en otra tienda (ticket 4e81b6c3): la venta es de la tienda donde se
 * hizo, y a la vez cuenta en el objetivo individual de quien la hizo. Las dos
 * lecturas se piden por separado y hay que poder unirlas sin contar de más.
 */
describe("fusionarVentas", () => {
  const enSuSede = { userId: "u_ana", tiendaId: "t1", articuloId: "art_fibra", cantidad: 2 };
  const cubriendo = { userId: "u_ana", tiendaId: "t9", articuloId: "art_fibra", cantidad: 3 };
  const deUnCompanero = { userId: "u_luis", tiendaId: "t1", articuloId: "art_fibra", cantidad: 4 };

  it("suma las dos listas sin duplicar lo que aparece en ambas", () => {
    // `enSuSede` sale en las dos consultas: es la MISMA venta, no dos.
    const r = fusionarVentas([enSuSede, deUnCompanero], [enSuSede, cubriendo]);
    expect(r).toHaveLength(3);
    expect(r.reduce((n, v) => n + v.cantidad, 0)).toBe(9);
  });

  it("una venta en otra tienda del mismo artículo NO se colapsa con la de su sede", () => {
    // Si se colapsaran, la tienda donde cubrió perdería su venta.
    const r = fusionarVentas([enSuSede], [cubriendo]);
    expect(r).toHaveLength(2);
    expect(r.map((v) => v.tiendaId).sort()).toEqual(["t1", "t9"]);
  });

  it("sin nada que fusionar devuelve lo que había", () => {
    expect(fusionarVentas([enSuSede])).toEqual([enSuSede]);
    expect(fusionarVentas([], [])).toEqual([]);
  });
});
