/**
 * Cierre de turno — lógica pura del módulo (plan Enterprise).
 *
 * Sin Prisma ni red: los handlers leen los datos y llaman a estas funciones,
 * igual que `src/lib/informes/queries.ts`. Así se testea sin base de datos.
 *
 * Regla que atraviesa el módulo: nada de aquí puede impedir fichar. El
 * registro de jornada es obligación legal (RD 8/2019) y no depende de que el
 * comercial haya cerrado su caja — lo que falte se reclama después.
 */

/** Pasos del asistente diario, en orden. */
export const PASOS_CIERRE = ["ventas", "resultados", "caja", "incidencias"] as const;
export type PasoCierre = (typeof PASOS_CIERRE)[number];

/** Estados de un cierre. "incompleto" no se guarda: se deduce del día. */
export type EstadoCierre = "borrador" | "completado" | "revisado";

/** Alcance de consulta según el rol de quien mira. */
export type AlcanceCierre = "propio" | "sede" | "todos";

/**
 * Qué puede ver cada rol:
 *  - EMPLEADO: solo sus cierres.
 *  - MANAGER (coordinador): los de su sede, para poder apretar.
 *  - OWNER: todos.
 */
export function alcanceSegunRol(rol: string): AlcanceCierre {
  if (rol === "OWNER") return "todos";
  if (rol === "MANAGER") return "sede";
  return "propio";
}

/** Áreas que solo ven coordinadores y administradores. */
export function puedeVerObjetivos(rol: string): boolean {
  return rol === "OWNER" || rol === "MANAGER";
}

/** La conciliación es solo de administración. */
export function puedeVerConciliacion(rol: string): boolean {
  return rol === "OWNER";
}

/** Fijar objetivos es de administración; el coordinador solo consulta. */
export function puedeFijarObjetivos(rol: string): boolean {
  return rol === "OWNER";
}

/**
 * Un cierre de caja confirmado no lo toca su autor: solo un administrador, y
 * dejando rastro (CierreCajaEdicion). Antes de confirmar, el comercial puede
 * corregir su propio borrador.
 */
export function puedeEditarCaja(rol: string, confirmado: boolean, esPropio: boolean): boolean {
  if (rol === "OWNER") return true;
  return !confirmado && esPropio;
}

/** Mes "YYYY-MM" de una fecha, en horario local. */
export function mesDe(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Porcentaje de consecución, redondeado a un decimal. Sin objetivo devuelve
 * null: mostrar "0 %" cuando nadie ha fijado objetivo es engañoso, y un 100 %
 * por dividir entre cero, peor.
 */
export function consecucion(vendido: number, objetivo: number): number | null {
  if (!Number.isFinite(objetivo) || objetivo <= 0) return null;
  return Math.round((vendido / objetivo) * 1000) / 10;
}

/**
 * Diferencia entre lo que la tienda declara en el arqueo y lo que suman los
 * cierres diarios de esa semana. Positiva = sobra efectivo; negativa = falta.
 */
export function diferenciaArqueo(declarado: number, segunCierres: number): number {
  return Math.round((declarado - segunCierres) * 100) / 100;
}

/**
 * ¿Contamos esta diferencia como descuadre? Por debajo del umbral es ruido
 * de redondeo y llenar la pantalla de avisos de céntimos la vuelve inútil.
 */
export const UMBRAL_DESCUADRE_EUR = 1;

export function esDescuadre(diferencia: number, umbral = UMBRAL_DESCUADRE_EUR): boolean {
  return Math.abs(diferencia) >= umbral;
}

/**
 * Qué pasos le faltan a un cierre. Lo usa la vigilancia diaria para decir en
 * qué se quedó cada persona, en vez de un "incompleto" sin más.
 */
export function pasosPendientes(cierre: {
  ventas: number;
  detalleJornada?: string | null;
  cajaConfirmada: boolean;
  completadoEn?: Date | null;
}): PasoCierre[] {
  const faltan: PasoCierre[] = [];
  if (cierre.ventas === 0 && !cierre.detalleJornada) faltan.push("ventas");
  if (!cierre.cajaConfirmada) faltan.push("caja");
  if (!cierre.completadoEn) faltan.push("incidencias");
  return faltan;
}

/** Un cierre está completo cuando no le falta ningún paso. */
export function estaCompleto(cierre: Parameters<typeof pasosPendientes>[0]): boolean {
  return pasosPendientes(cierre).length === 0;
}
