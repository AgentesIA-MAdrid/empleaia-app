/**
 * Cuánto efectivo lleva ACUMULADO una tienda pendiente de arquear
 * (ticket 5f0a92c7).
 *
 * Cómo funciona la caja del cliente, en sus palabras:
 *
 *  - Cada tienda tiene un **fondo de cambio** fijo, igual en todas. Ese dinero
 *    no se cuenta, no se arquea y no se toca: aquí no se modela en absoluto.
 *  - Aparte, se va **acumulando** el efectivo que los comerciales declaran en
 *    sus cierres de caja diarios.
 *  - Los **domingos** se prepara el arqueo: se cuenta ese acumulado, se mete en
 *    un sobre y la caja **vuelve a cero**. El sobre espera en la tienda a que
 *    pase un responsable a recogerlo y firmarlo.
 *
 * De ahí la cuenta:
 *
 *     acumulado = arranque + efectivo cobrado desde entonces
 *
 * El **arranque** es el último saldo registrado de esa tienda (`FondoCaja`): al
 * principio, el que cargó administración desde su Excel para no perder lo que ya
 * había en el cajón el día que se estrenó el sistema; a partir de ahí, el cero
 * que deja cada arqueo declarado. Es el saldo al CERRAR ese día, así que los
 * cobros que cuentan son los de los días siguientes: si no, el dinero del propio
 * día se contaría dos veces.
 *
 * (Ojo con el nombre de la tabla: `FondoCaja` guarda este acumulado de arranque,
 * NO el fondo de cambio.)
 *
 * Cuando el arranque está **en incidencia** (cargado sin importe porque la caja
 * no cuadraba) no hay acumulado que dar y se dice: poner un 0 ahí sería
 * inventarse que la caja estaba vacía, y todo lo que se calcule encima arrastra
 * la mentira.
 */

export interface ArranqueCaja {
  /** Día al que corresponde el saldo. */
  fecha: Date;
  /** null cuando se registró en incidencia: no hay cifra fiable. */
  importe: number | null;
  incidencia: string | null;
}

export type MotivoSinSaldo = "sin_arranque" | "arranque_en_incidencia";

export interface SaldoCaja {
  /** Efectivo que debería haber acumulado, a falta de arquear. null si no se sabe. */
  esperado: number | null;
  /** Por qué no se sabe (solo cuando `esperado` es null). */
  motivo: MotivoSinSaldo | null;
  /** Las dos piezas de la cuenta, para poder enseñarla desglosada. */
  arranque: number | null;
  cobrado: number;
}

export function acumuladoEnCaja(args: {
  arranque: ArranqueCaja | null;
  /** Efectivo de los cierres de caja posteriores a la fecha del arranque. */
  cobrado: number;
}): SaldoCaja {
  const cobrado = redondear(args.cobrado);

  if (!args.arranque) {
    return { esperado: null, motivo: "sin_arranque", arranque: null, cobrado };
  }
  if (args.arranque.importe === null) {
    return { esperado: null, motivo: "arranque_en_incidencia", arranque: null, cobrado };
  }

  const arranque = redondear(args.arranque.importe);
  return { esperado: redondear(arranque + cobrado), motivo: null, arranque, cobrado };
}

/**
 * Diferencia entre lo que la tienda mete en el sobre y lo que debería haber
 * acumulado. Positiva = sobra dinero; negativa = falta. Sin acumulado calculable
 * no hay diferencia que dar: es distinto de "cuadra".
 */
export function diferenciaSaldo(declarado: number, esperado: number | null): number | null {
  if (esperado === null) return null;
  return redondear(declarado - esperado);
}

/**
 * El primer día cuyos cobros cuentan: el siguiente al del arranque. El arranque
 * es el saldo AL CERRAR su día, así que lo cobrado ese día ya está dentro.
 */
export function desdeCuandoCuentan(arranque: ArranqueCaja): Date {
  const d = new Date(arranque.fecha);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
