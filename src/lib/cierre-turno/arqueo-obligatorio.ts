/**
 * A quién le toca preparar el arqueo semanal (ticket 3b7e05d1).
 *
 * Regla del cliente: **el último turno del último día que abre la tienda**.
 * Quien la cierra ese día cuenta el efectivo acumulado, lo mete en un sobre y lo
 * declara antes de poder cerrar su turno. El sobre espera en la tienda a que
 * pase un responsable a firmar la recogida.
 *
 * Ese día NO es el mismo en todas: las de centro comercial abren el domingo y
 * arquean ese día; las de calle cierran el sábado y arquean entonces, porque el
 * domingo no hay nadie que cuente el dinero (ticket 2c9d84f1). Lo dice
 * `Tienda.arqueoDiaSemana`, en numeración ISO.
 *
 * Cómo se decide quién es "el último":
 *
 *  - Es el día de arqueo de su sede.
 *  - Su sede todavía no tiene el arqueo de esa semana declarado. Si un compañero
 *    ya lo hizo, al resto no se les vuelve a pedir.
 *  - **Nadie de su sede termina después que él**, según el cuadrante publicado.
 *    Con el cuadrante vacío o mal puesto —que pasa— nadie termina después, así
 *    que le toca a quien esté cerrando: es mejor que se haga y sobre una
 *    comprobación, a que la semana se quede sin arquear porque el turno no
 *    estaba bien metido.
 *
 * Las sedes que no manejan efectivo nuestro (un córner que liquida el centro) y
 * la oficina quedan fuera: ahí no hay caja que arquear, igual que en la pantalla
 * de arqueos.
 *
 * El importe se pide **a ciegas**, sin enseñarle antes lo que debería haber: si
 * ve la cifra esperada, la teclea sin contar y el arqueo deja de servir para
 * detectar un descuadre. La comparación se le enseña justo después de guardar.
 */

/** Día de la semana ISO de una fecha: 1 = lunes … 7 = domingo. */
export function diaSemanaISO(fecha: Date): number {
  const d = fecha.getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * ¿Es hoy el día en que esta sede arquea? Sin dato de la sede se asume domingo,
 * que es lo que hacía antes de existir el campo.
 */
export function esDiaDeArqueo(fecha: Date, arqueoDiaSemana?: number | null): boolean {
  const dia = arqueoDiaSemana && arqueoDiaSemana >= 1 && arqueoDiaSemana <= 7 ? arqueoDiaSemana : 7;
  return diaSemanaISO(fecha) === dia;
}

export interface TurnoDelDia {
  userId: string;
  /** "HH:MM" del cuadrante. */
  horaFin: string;
}

/**
 * ¿Es el último en salir de su sede hoy? Empatar cuenta como serlo: si dos
 * cierran a la misma hora, al primero que llegue le toca y al otro ya no se le
 * pide (el arqueo estará declarado).
 */
export function esElUltimoEnSalir(args: {
  userId: string;
  /** Turnos publicados de esa sede y ese día, el suyo incluido. */
  turnosDeLaSede: TurnoDelDia[];
}): boolean {
  const mio = args.turnosDeLaSede.find((t) => t.userId === args.userId);
  // Sin turno propio en el cuadrante (un correturnos que ha entrado a cubrir):
  // si está cerrando la tienda un domingo, se le pide.
  if (!mio) return true;
  return !args.turnosDeLaSede.some(
    (t) => t.userId !== args.userId && aMinutos(t.horaFin) > aMinutos(mio.horaFin),
  );
}

export function tocaArqueo(args: {
  fecha: Date;
  userId: string;
  turnosDeLaSede: TurnoDelDia[];
  /** Ya lo declaró alguien de la sede esta semana. */
  arqueoYaDeclarado: boolean;
  /** La sede no maneja efectivo nuestro, o es la oficina. */
  sedeSinCaja: boolean;
  /** Día ISO en que arquea esta sede (1 = lunes … 7 = domingo). */
  arqueoDiaSemana?: number | null;
}): boolean {
  if (args.sedeSinCaja) return false;
  if (!esDiaDeArqueo(args.fecha, args.arqueoDiaSemana)) return false;
  if (args.arqueoYaDeclarado) return false;
  return esElUltimoEnSalir({ userId: args.userId, turnosDeLaSede: args.turnosDeLaSede });
}

/** "22:30" → 1350. Una hora ilegible se trata como el final del día. */
function aMinutos(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return 24 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}
