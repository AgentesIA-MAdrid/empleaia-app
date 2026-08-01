/**
 * El detalle de los dos cuadres de una tienda (ticket 1e73c9a4).
 *
 * La conciliación daba un total por sede y un "cuadra / no cuadra". Cuando no
 * cuadra, eso no sirve para nada: hay que poder abrir la tienda y ver **qué
 * día** y **qué movimiento** es el que se ha torcido. De ahí las dos vistas:
 *
 *  - **Efectivo**: el libro de caja. Lo que entra (el efectivo de cada cierre
 *    diario) y lo que sale (las retiradas que firma un responsable), en orden,
 *    con el saldo después de cada movimiento.
 *  - **Tarjeta**: día a día, lo que la tienda dice haber cobrado con datáfono
 *    frente a lo que el banco ingresó **al día siguiente**. Las liquidaciones
 *    del datáfono entran con desfase, así que comparar el mismo día siempre
 *    daría descuadre: lo cobrado el 1 aparece en el extracto con fecha del 2.
 */

/** Un apunte del libro de caja. */
export interface MovimientoCaja {
  fecha: string;
  /** "saldo" fija el acumulado; "entrada" suma; "salida" resta. */
  tipo: "saldo" | "entrada" | "salida";
  concepto: string;
  /** Quién lo hizo: el comercial que cerró, o el responsable que retiró. */
  quien: string | null;
  importe: number;
  /** Saldo de la caja después de este movimiento. */
  saldo: number;
  /** Para poder abrir el cierre o el arqueo de origen. */
  origenId?: string | null;
}

export interface EntradaCaja {
  fecha: string;
  importe: number;
  quien: string | null;
  cierreId?: string | null;
}

export interface SalidaCaja {
  fecha: string;
  importe: number;
  quien: string | null;
  semana?: string | null;
  arqueoId?: string | null;
}

export interface SaldoFijado {
  fecha: string;
  importe: number | null;
  nota?: string | null;
}

/**
 * El libro de caja en orden. Los saldos fijados (`FondoCaja`) no suman: fijan el
 * acumulado a partir de ese punto, porque son un recuento real del cajón —el que
 * cargó administración al empezar, o el cero que deja cada arqueo—.
 *
 * Dentro del mismo día el orden es: primero el saldo fijado, luego las entradas
 * y al final las salidas. Es el orden en que ocurren de verdad: se cuenta lo que
 * hay, se cobra durante el día y al cerrar se retira.
 */
export function libroDeCaja(args: {
  saldos: SaldoFijado[];
  entradas: EntradaCaja[];
  salidas: SalidaCaja[];
}): { movimientos: MovimientoCaja[]; saldoFinal: number } {
  const orden = { saldo: 0, entrada: 1, salida: 2 } as const;

  const sinOrdenar: Omit<MovimientoCaja, "saldo">[] = [
    ...args.saldos
      // Un saldo en incidencia no dice cuánto había: no fija nada.
      .filter((s) => s.importe !== null)
      .map((s) => ({
        fecha: s.fecha,
        tipo: "saldo" as const,
        concepto: s.nota?.trim() || "Saldo de la caja",
        quien: null,
        importe: s.importe as number,
      })),
    ...args.entradas.map((e) => ({
      fecha: e.fecha,
      tipo: "entrada" as const,
      concepto: "Efectivo del cierre de caja",
      quien: e.quien,
      importe: e.importe,
      origenId: e.cierreId ?? null,
    })),
    ...args.salidas.map((s) => ({
      fecha: s.fecha,
      tipo: "salida" as const,
      concepto: s.semana ? `Retirada del arqueo ${s.semana}` : "Retirada de efectivo",
      quien: s.quien,
      importe: s.importe,
      origenId: s.arqueoId ?? null,
    })),
  ];

  sinOrdenar.sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || orden[a.tipo] - orden[b.tipo],
  );

  let saldo = 0;
  const movimientos = sinOrdenar.map((m) => {
    if (m.tipo === "saldo") saldo = m.importe;
    else if (m.tipo === "entrada") saldo += m.importe;
    else saldo -= m.importe;
    saldo = redondear(saldo);
    return { ...m, saldo };
  });

  return { movimientos, saldoFinal: saldo };
}

/** Una fila del cuadre de tarjeta: un día de ventas contra su ingreso. */
export interface FilaCuadreTarjeta {
  /** Día en que se cobró con el datáfono. */
  fecha: string;
  /** Día en que ese dinero aparece en el banco (fecha + desfase). */
  fechaBanco: string;
  declarado: number;
  banco: number;
  diferencia: number;
  descuadre: boolean;
  /** Cuántos movimientos del extracto se han sumado en `banco`. */
  movimientos: number;
}

export const DESFASE_BANCO_DIAS = 1;

/**
 * Cuadre día a día. `declaradoPorDia` son las ventas con tarjeta de los cierres
 * y `bancoPorDia` los ingresos del extracto, ambos indexados por su propia
 * fecha; el desfase los alinea.
 *
 * Se listan todos los días con algo en cualquiera de los dos lados: un día sin
 * ventas pero con un ingreso del banco es justo lo que hay que mirar.
 */
export function cuadreTarjeta(args: {
  declaradoPorDia: Map<string, number>;
  bancoPorDia: Map<string, { importe: number; movimientos: number }>;
  desfaseDias?: number;
  umbral?: number;
}): FilaCuadreTarjeta[] {
  const desfase = args.desfaseDias ?? DESFASE_BANCO_DIAS;
  const umbral = args.umbral ?? 1;

  // Días de venta: los que tienen ventas, más los que explicarían un ingreso.
  const dias = new Set<string>(args.declaradoPorDia.keys());
  for (const fechaBanco of args.bancoPorDia.keys()) {
    dias.add(sumarDias(fechaBanco, -desfase));
  }

  return [...dias]
    .sort()
    .map((fecha) => {
      const fechaBanco = sumarDias(fecha, desfase);
      const declarado = redondear(args.declaradoPorDia.get(fecha) ?? 0);
      const b = args.bancoPorDia.get(fechaBanco) ?? { importe: 0, movimientos: 0 };
      const banco = redondear(b.importe);
      const diferencia = redondear(banco - declarado);
      return {
        fecha,
        fechaBanco,
        declarado,
        banco,
        diferencia,
        descuadre: Math.abs(diferencia) >= umbral,
        movimientos: b.movimientos,
      };
    })
    // Un día a cero por los dos lados no aporta nada a la vista.
    .filter((f) => f.declarado !== 0 || f.banco !== 0);
}

/** "2026-08-01" + 1 → "2026-08-02". Con días negativos, hacia atrás. */
export function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}
