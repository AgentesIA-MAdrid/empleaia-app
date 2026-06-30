/**
 * Lógica pura de aplicabilidad de festivos a empleados.
 *
 * Reglas (acordadas en el ticket de calendario de ausencias):
 *  - Festivo "nacional"  → aplica a TODA la plantilla.
 *  - Festivo "local"     → aplica SOLO a los empleados de su sede (`tiendaId`).
 *  - Excepción por empleado → ese empleado trabaja ese día pese al festivo
 *    (un administrador se lo "quita" para asignar jornada / horas extra).
 *
 * Función pura, sin acceso a BD: recibe los datos ya cargados. Así la
 * comparten el route handler (`/api/festivos?scope=me`) y los tests sin
 * fetch interno entre rutas (ver convención en AGENTS.md).
 */

export interface FestivoAplicable {
  ambito: string;
  tiendaId: string | null;
  excepciones: { userId: string }[];
}

export interface EmpleadoFestivo {
  id: string;
  tiendaId: string | null;
}

/**
 * ¿Le aplica este festivo a este empleado (es decir, ese día NO trabaja)?
 * Devuelve false si tiene una excepción (trabaja) o si es un festivo local
 * de otra sede.
 */
export function festivoAplicaA(
  festivo: FestivoAplicable,
  empleado: EmpleadoFestivo,
): boolean {
  // Excepción explícita: el empleado trabaja ese día.
  if (festivo.excepciones.some((e) => e.userId === empleado.id)) return false;

  if (festivo.ambito === "local") {
    // Solo aplica a la sede del festivo.
    return festivo.tiendaId != null && festivo.tiendaId === empleado.tiendaId;
  }

  // "nacional" (o cualquier otro ámbito por defecto): aplica a todos.
  return true;
}
