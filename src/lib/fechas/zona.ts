/**
 * Fechas y horas escritas en la zona del cliente, no en la del servidor.
 *
 * El bug que esto cierra (ticket 3c91f0ab): el contenedor de producción corre
 * en **UTC**, así que un `toLocaleString("es-ES")` sin zona escribía una salida
 * de las 16:00 de Madrid como "14:00". Lo vio el cliente en las notificaciones
 * de solicitudes de fichaje —"pide registrar un fichaje de Salida a las
 * 14:00"— cuando el turno de esas personas acababa a las 16:00, y uno de sus
 * empleados hasta lo escribió en el motivo ("Solicito fichar la salida a las
 * 16:00"). El instante guardado era correcto; el texto, no.
 *
 * Dónde importa: en todo lo que se compone en el SERVIDOR (notificaciones,
 * correos, PDF de firma). En el navegador no pasa, porque ahí la zona por
 * defecto es la del propio usuario.
 *
 * La zona sale de `ConfiguracionEmpresa.zonaHoraria` cuando quien formatea la
 * tiene a mano; si no, del valor por defecto, que es el mismo que trae la
 * configuración de un tenant nuevo.
 */

/** La misma que el default de `ConfiguracionEmpresa.zonaHoraria`. */
export const ZONA_DEFECTO = "Europe/Madrid";

/**
 * Una zona que `Intl` acepte. Una zona inventada haría que `format` lance y
 * tumbe un correo o un PDF por un dato de adorno, así que se cae al default.
 */
function zonaValida(zona: string | null | undefined): string {
  if (!zona) return ZONA_DEFECTO;
  try {
    new Intl.DateTimeFormat("es-ES", { timeZone: zona });
    return zona;
  } catch {
    return ZONA_DEFECTO;
  }
}

/** "31/07/2026, 16:00" en la zona del cliente. */
export function fechaHoraEnZona(
  d: Date | string,
  zona?: string | null,
  opciones?: Intl.DateTimeFormatOptions,
): string {
  const fecha = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zonaValida(zona),
    ...opciones,
  }).format(fecha);
}

/** "31 de julio de 2026" en la zona del cliente. */
export function fechaEnZona(
  d: Date | string,
  zona?: string | null,
  opciones?: Intl.DateTimeFormatOptions,
): string {
  const fecha = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: zonaValida(zona),
    ...opciones,
  }).format(fecha);
}
