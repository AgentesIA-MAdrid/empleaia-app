/**
 * Horas de contrato imputables a un periodo y diferencia frente a las horas
 * contabilizadas (fichadas o planificadas en el cuadrante).
 *
 * Es el mismo criterio que ya aplica la columna "Contrato" del cuadrante
 * (`/admin/turnos`): las horas de contrato son SEMANALES y de la persona
 * (`User.horasSemanalesContrato`, con `ConfiguracionEmpresa.horasSemanales`
 * como valor por defecto), no de la sede. Aquí sólo se añade el prorrateo
 * al periodo del informe, que puede ser de un día o de varios meses.
 *
 * Módulo puro (sin Prisma ni red) → testeable y compartible por los informes
 * de resumen y de horas por centro.
 */

/** Decimal de Prisma, número o string serializado en JSON. */
export type HorasContratoRaw =
  | number
  | string
  | { toString(): string }
  | null
  | undefined;

/** Jornada semanal de referencia cuando no hay ni contrato ni configuración. */
export const HORAS_SEMANALES_POR_DEFECTO = 40;

/**
 * Horas semanales de contrato efectivas de una persona: las suyas si las
 * tiene, si no las de la empresa, y si tampoco, 40 (mismo default que
 * `ConfiguracionEmpresa.horasSemanales`).
 */
export function horasSemanalesDe(
  horasSemanalesContrato: HorasContratoRaw,
  horasSemanalesEmpresa: number | null | undefined,
): number {
  if (horasSemanalesContrato != null && horasSemanalesContrato !== "") {
    const propias = Number(horasSemanalesContrato);
    if (!Number.isNaN(propias) && propias >= 0) return propias;
  }
  const empresa = Number(horasSemanalesEmpresa);
  if (!Number.isNaN(empresa) && empresa > 0) return empresa;
  return HORAS_SEMANALES_POR_DEFECTO;
}

/**
 * Días naturales que cubre el periodo del informe.
 *
 * Se mide sobre los instantes y se redondea a días en vez de comparar
 * componentes de fecha: las fechas llegan como ISO en UTC (`…T00:00:00Z` /
 * `…T23:59:59Z`) y el servidor puede estar en otro huso, así que comparar
 * `getDate()` colaría un día de más o de menos. Con `fechaFin` a final del
 * día, una semana da 7 y un mes de 31 días da 31.
 */
export function diasDelPeriodo(fechaInicio: Date, fechaFin: Date): number {
  const ms = fechaFin.getTime() - fechaInicio.getTime();
  if (Number.isNaN(ms)) return 1;
  return Math.max(1, Math.round(ms / 86_400_000));
}

/** Contrato semanal prorrateado a los días del periodo. */
export function horasContratoPeriodo(
  horasSemanales: number,
  dias: number,
): number {
  return Math.round(((horasSemanales / 7) * dias) * 100) / 100;
}

/**
 * Diferencia entre lo contabilizado y el contrato del periodo.
 * Positiva = exceso (horas extra); negativa = por debajo del contrato.
 */
export function diferenciaContrato(
  horas: number,
  horasContrato: number,
): number {
  return Math.round((horas - horasContrato) * 100) / 100;
}
