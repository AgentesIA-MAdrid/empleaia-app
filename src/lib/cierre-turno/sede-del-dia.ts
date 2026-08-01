/**
 * En qué tienda ha trabajado hoy quien va a cerrar el turno (ticket 8c05f3e1).
 *
 * El problema que resuelve: el cierre usaba la sede de la ficha del empleado, y
 * quien no tiene ninguna —un correturnos— veía "No tienes sede asignada" en los
 * objetivos de tienda y en la caja, estando de hecho trabajando en una. Lo mismo
 * pasa cuando el cuadrante está mal puesto: cerraba en la tienda equivocada sin
 * que nadie se enterara.
 *
 * Ahora se le pregunta antes de empezar, pero con la respuesta ya elegida: la
 * gracia es que confirme de un toque, no que busque su tienda en una lista de
 * veinte. Las pistas se miran en este orden, de la más fiable a la menos:
 *
 *  1. **Dónde fichó**: la tienda más cercana a las coordenadas de su entrada de
 *     hoy. Es el dato más fuerte que hay —estaba allí— y por eso va primero,
 *     incluso por delante del cuadrante: si el cuadrante está mal, esto lo pilla.
 *     Solo vale si está razonablemente cerca (`MAX_DISTANCIA_SEDE_M`); con el
 *     GPS a 8 km, la tienda "más cercana" no significa nada.
 *  2. **El turno del cuadrante** de hoy, si lo tiene.
 *  3. **Su sede de la ficha**, que es lo que se usaba antes.
 *
 * Devuelve también el motivo, para que la pantalla pueda decir por qué propone
 * esa: "has fichado aquí" se lee distinto que "es la de tu cuadrante".
 */

import { calcularDistancia } from "@/lib/utils";

/** Tope para fiarse de la ubicación: más lejos, el GPS no señala una tienda. */
export const MAX_DISTANCIA_SEDE_M = 500;

export interface SedeCandidata {
  id: string;
  nombre: string;
  latitud: number | null;
  longitud: number | null;
}

export type MotivoSede = "ubicacion" | "turno" | "ficha" | "ninguna";

export interface SugerenciaSede {
  sedeId: string | null;
  motivo: MotivoSede;
  /** Metros a la sede propuesta, solo cuando el motivo es la ubicación. */
  distancia: number | null;
}

export function sugerirSedeDelDia(opts: {
  /** Coordenadas del fichaje de entrada de hoy, si el móvil las dio. */
  fichaje: { latitud: number | null; longitud: number | null } | null;
  /** Sede del turno publicado de hoy. */
  turnoTiendaId: string | null;
  /** Sede de su ficha (`User.tiendaId`). */
  fichaTiendaId: string | null;
  sedes: SedeCandidata[];
  maxDistanciaM?: number;
}): SugerenciaSede {
  const tope = opts.maxDistanciaM ?? MAX_DISTANCIA_SEDE_M;
  const activas = opts.sedes;

  // 1. Dónde fichó.
  const { latitud, longitud } = opts.fichaje ?? { latitud: null, longitud: null };
  if (latitud !== null && longitud !== null) {
    let mejor: { id: string; distancia: number } | null = null;
    for (const s of activas) {
      if (s.latitud === null || s.longitud === null) continue;
      const d = Math.round(calcularDistancia(latitud, longitud, s.latitud, s.longitud));
      if (!mejor || d < mejor.distancia) mejor = { id: s.id, distancia: d };
    }
    if (mejor && mejor.distancia <= tope) {
      return { sedeId: mejor.id, motivo: "ubicacion", distancia: mejor.distancia };
    }
  }

  // 2. El cuadrante.
  if (opts.turnoTiendaId && activas.some((s) => s.id === opts.turnoTiendaId)) {
    return { sedeId: opts.turnoTiendaId, motivo: "turno", distancia: null };
  }

  // 3. Su ficha.
  if (opts.fichaTiendaId && activas.some((s) => s.id === opts.fichaTiendaId)) {
    return { sedeId: opts.fichaTiendaId, motivo: "ficha", distancia: null };
  }

  // Sin ninguna pista: que la elija él. Es el caso del correturnos que ficha
  // sin dar ubicación y sin turno puesto.
  return { sedeId: null, motivo: "ninguna", distancia: null };
}
