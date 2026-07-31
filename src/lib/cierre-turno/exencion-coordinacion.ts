/**
 * Controles de tienda de los que está exenta la coordinación (ticket 73).
 *
 * Lo que pidió el cliente: *"Ellas no cierran caja ni tienen que firmar el
 * check de inicio y cierre de turno a no ser que fichen en una sede distinta a
 * oficina"*. Una coordinadora pasa el día en la oficina y solo de vez en cuando
 * cubre en un punto de venta; el día que cubre, hace lo mismo que el resto.
 *
 * La guía es **su turno del cuadrante**, no dónde esté físicamente: es el dato
 * que administración ya mantiene y el mismo que se usa para el resto de
 * comprobaciones del fichaje (ver `horario-turno.ts`).
 *
 * Reglas:
 *  - Solo exime al coordinador (MANAGER). Un comercial nunca está exento, y
 *    administración no ficha en tienda.
 *  - Con turno en la sede marcada como oficina (`Tienda.esOficina`), exenta.
 *  - Con turno en cualquier otro punto de venta, NO exenta: ese día abre,
 *    vende y cuadra caja como el resto del equipo.
 *  - Jornada partida en dos sitios (oficina por la mañana, tienda por la
 *    tarde): manda la tienda. Si ese día pisa un punto de venta, tiene que
 *    hacer sus controles.
 *  - Sin turno ese día, exenta: no hay cuadrante que la ponga en una tienda,
 *    y su sitio por defecto es la oficina (misma idea que
 *    `User.turnoOficinaPorDefecto`, el relleno automático del cuadrante).
 *
 * Función pura: recibe los turnos ya leídos, así que se prueba sin BD (misma
 * pauta que `core.ts` y `checklist.ts`).
 */

/** Turno del día, con lo justo para decidir: en qué sede es. */
export interface TurnoSede {
  /** `Tienda.esOficina` de la sede del turno. */
  esOficina: boolean;
}

export function exentoDeControlesDeTienda(opts: {
  rol: string;
  turnosDelDia: TurnoSede[];
}): boolean {
  if (opts.rol !== "MANAGER") return false;
  if (opts.turnosDelDia.length === 0) return true;
  return opts.turnosDelDia.every((t) => t.esOficina);
}
