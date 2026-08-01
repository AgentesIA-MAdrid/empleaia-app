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
 *  - Turno en la sede marcada como oficina (`Tienda.esOficina`): exento SEA
 *    QUIEN SEA (ticket 9d4e17c2). Allí no hay caja ni stock, así que firmar que
 *    se han revisado sería firmar en falso.
 *  - Sin turno ese día solo se exime al coordinador: su sitio por defecto es la
 *    oficina, mientras que un comercial que ficha está en una tienda.
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
  // En la oficina no se cierra turno ni se firman los puntos de control, sea
  // quien sea: es trabajo de oficina, no de tienda, y ahí no hay caja que
  // cuadrar ni stock que revisar (ticket 9d4e17c2). Antes esto solo eximía al
  // coordinador, y dejaba a la gente de administración firmando que había
  // revisado una tienda en la que no estaba.
  if (opts.turnosDelDia.length > 0 && opts.turnosDelDia.every((t) => t.esOficina)) return true;
  // Sin turno ese día, solo se exime al coordinador: su sitio por defecto es la
  // oficina. A un comercial sin turno no se le quitan los controles, porque si
  // ficha es que está en una tienda.
  if (opts.rol !== "MANAGER") return false;
  return opts.turnosDelDia.length === 0;
}
