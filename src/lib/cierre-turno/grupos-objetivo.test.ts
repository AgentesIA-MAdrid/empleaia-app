import { describe, it, expect } from "vitest";
import { describeMiembrosGrupo, gruposVisiblesPara, resumirGrupo } from "./grupos-objetivo";

const TMT = {
  id: "g_tmt",
  nombre: "TMT",
  miembros: [
    { userId: "ana", tiendaId: null },
    { userId: null, tiendaId: "t1" },
  ],
};
const AJENO = {
  id: "g_ajeno",
  nombre: "Otra zona",
  miembros: [{ userId: null, tiendaId: "t9" }],
};

describe("resumirGrupo", () => {
  it("parte los miembros en comerciales y sedes", () => {
    expect(resumirGrupo(TMT)).toEqual({
      id: "g_tmt",
      nombre: "TMT",
      userIds: ["ana"],
      tiendaIds: ["t1"],
    });
  });
});

describe("gruposVisiblesPara", () => {
  it("administración los ve todos, hasta los vacíos", () => {
    const vacio = { id: "g_nuevo", nombre: "Sin gente", miembros: [] };
    const vistos = gruposVisiblesPara([TMT, AJENO, vacio], { tiendaIds: null, userIds: [] });
    expect(vistos.map((g) => g.id)).toEqual(["g_tmt", "g_ajeno", "g_nuevo"]);
  });

  it("coordinación solo ve los grupos que caen enteros en sus sedes", () => {
    const vistos = gruposVisiblesPara([TMT, AJENO], { tiendaIds: ["t1"], userIds: ["ana"] });
    expect(vistos.map((g) => g.id)).toEqual(["g_tmt"]);
  });

  it("un grupo con gente de fuera no se le enseña a medias", () => {
    const mezclado = {
      id: "g_mezcla",
      nombre: "Mezcla",
      miembros: [
        { userId: "ana", tiendaId: null },
        { userId: "sara", tiendaId: null },
      ],
    };
    // Sara no está en sus sedes: la consecución saldría recortada.
    expect(gruposVisiblesPara([mezclado], { tiendaIds: ["t1"], userIds: ["ana"] })).toEqual([]);
  });

  it("a coordinación no se le pinta un grupo sin miembros", () => {
    const vacio = { id: "g_nuevo", nombre: "Sin gente", miembros: [] };
    expect(gruposVisiblesPara([vacio], { tiendaIds: ["t1"], userIds: ["ana"] })).toEqual([]);
  });
});

describe("describeMiembrosGrupo", () => {
  it("cuenta comerciales y puntos de venta, en singular y en plural", () => {
    expect(describeMiembrosGrupo(resumirGrupo(TMT))).toBe("1 comercial · 1 punto de venta");
    expect(
      describeMiembrosGrupo({ id: "g", nombre: "G", userIds: ["a", "b"], tiendaIds: ["t1", "t2"] }),
    ).toBe("2 comerciales · 2 puntos de venta");
  });

  it("lo dice cuando todavía no tiene a nadie", () => {
    expect(describeMiembrosGrupo({ id: "g", nombre: "G", userIds: [], tiendaIds: [] })).toBe(
      "Sin miembros",
    );
  });
});
