/**
 * Grupos de objetivos — lógica pura (ticket ff5ab304).
 *
 * Un grupo de objetivos es el tercer ámbito de los objetivos de venta, junto al
 * comercial ("individual") y al punto de venta ("tienda"): una agrupación con
 * nombre del cliente ("TMT", "Televenta"…) formada por comerciales y/o sedes, a
 * la que se le fija su propio objetivo.
 *
 * Aquí solo van las decisiones que no tocan base de datos —quién ve qué grupo y
 * cómo se resume su composición—, para poder probarlas sin Prisma, igual que
 * `objetivos.ts`.
 *
 * No confundir con el *grupo de productos* (`ObjetivoVenta.subcategoria`), que
 * es de qué va el objetivo y no a quién va dirigido.
 */

import type { GrupoObjetivoResumen } from "./objetivos";

/** Grupo tal y como sale de la tabla, con sus miembros. */
export interface GrupoConMiembros {
  id: string;
  nombre: string;
  miembros: { userId: string | null; tiendaId: string | null }[];
}

/** Pasa un grupo de la tabla a la forma que usan los cálculos de objetivos. */
export function resumirGrupo(g: GrupoConMiembros): GrupoObjetivoResumen {
  return {
    id: g.id,
    nombre: g.nombre,
    userIds: g.miembros.map((m) => m.userId).filter((x): x is string => Boolean(x)),
    tiendaIds: g.miembros.map((m) => m.tiendaId).filter((x): x is string => Boolean(x)),
  };
}

/**
 * Grupos que puede ver quien mira la pantalla.
 *
 * Administración (`alcance.tiendaIds === null`) los ve todos. Coordinación solo
 * ve los grupos que caen enteros dentro de sus sedes: si un grupo mezcla su
 * gente con la de otra zona, las ventas que se le sirven están recortadas por
 * sede y la consecución que vería sería falsa —mejor no enseñarlo que enseñar
 * un número que no es—. Un grupo sin miembros tampoco es de nadie en concreto,
 * así que a coordinación no se le pinta.
 */
export function gruposVisiblesPara(
  grupos: GrupoConMiembros[],
  alcance: { tiendaIds: string[] | null; userIds: string[] },
): GrupoObjetivoResumen[] {
  const resumidos = grupos.map(resumirGrupo);
  if (alcance.tiendaIds === null) return resumidos;

  const sedes = new Set(alcance.tiendaIds);
  const personas = new Set(alcance.userIds);
  return resumidos.filter(
    (g) =>
      g.userIds.length + g.tiendaIds.length > 0 &&
      g.tiendaIds.every((t) => sedes.has(t)) &&
      g.userIds.every((u) => personas.has(u)),
  );
}

/** Composición del grupo en una línea, para el subtítulo de su fila. */
export function describeMiembrosGrupo(g: GrupoObjetivoResumen): string {
  const partes: string[] = [];
  if (g.userIds.length > 0) {
    partes.push(`${g.userIds.length} ${g.userIds.length === 1 ? "comercial" : "comerciales"}`);
  }
  if (g.tiendaIds.length > 0) {
    partes.push(
      `${g.tiendaIds.length} ${g.tiendaIds.length === 1 ? "punto de venta" : "puntos de venta"}`,
    );
  }
  return partes.length > 0 ? partes.join(" · ") : "Sin miembros";
}
