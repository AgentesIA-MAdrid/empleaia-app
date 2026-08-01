/**
 * El mes en curso como rango de fechas, para los filtros de la conciliación.
 *
 * Vive aparte porque lo usan las páginas (server) y los paneles (cliente), y
 * duplicarlo acabaría con dos versiones que no coinciden en el cambio de mes.
 */
export function primerYUltimoDiaDelMes(hoy: Date = new Date()): {
  desde: string;
  hasta: string;
} {
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    desde: iso(new Date(Date.UTC(y, m, 1))),
    // Día 0 del mes siguiente = último del actual.
    hasta: iso(new Date(Date.UTC(y, m + 1, 0))),
  };
}
