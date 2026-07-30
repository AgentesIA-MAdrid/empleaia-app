/**
 * Objetivos de venta — lógica pura (entrega 3 del módulo "Cierre de turno").
 *
 * Sin Prisma ni red: el handler lee objetivos y ventas agregadas, y estas
 * funciones deciden qué cuenta para qué objetivo y cuánto se lleva conseguido.
 * Igual que `core.ts`, así se prueba sin base de datos.
 *
 * Reglas del modelo, para no repetirlas en cada pantalla:
 *  - Un objetivo es de UN comercial o de UNA sede, nunca de los dos.
 *  - Sin `articuloId`, el objetivo es de unidades totales (todo el catálogo).
 *  - El objetivo de una sede se compara con lo que vendió la sede completa,
 *    no con la suma de los objetivos de sus comerciales: son dos formas de
 *    apretar y el cliente usa la que quiere en cada momento.
 */

export type AmbitoObjetivo = "comercial" | "sede";

/** Objetivo tal como sale de la tabla, con lo justo para calcular. */
export interface ObjetivoFila {
  id: string;
  mes: string;
  userId: string | null;
  tiendaId: string | null;
  articuloId: string | null;
  cantidad: number;
}

/**
 * Ventas del mes ya agrupadas por comercial, sede y artículo. `tiendaId` es la
 * sede del cierre (la que tenía el comercial ese día), no la actual del
 * empleado: si alguien cambia de tienda a mitad de mes, lo vendido se queda
 * donde se vendió.
 */
export interface VentaAgregada {
  userId: string;
  tiendaId: string | null;
  articuloId: string | null;
  cantidad: number;
}

export interface FilaConsecucion {
  objetivoId: string;
  ambito: AmbitoObjetivo;
  /** Id del comercial o de la sede, según el ámbito. */
  sujetoId: string;
  articuloId: string | null;
  objetivo: number;
  vendido: number;
  /** null cuando no hay objetivo con el que comparar. */
  consecucion: number | null;
}

export const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Tope defensivo: un objetivo mensual de más de un millón de unidades es un dedazo. */
export const OBJETIVO_MAX = 1_000_000;

/** Valida un mes "YYYY-MM" venido del cliente. */
export function normalizarMes(valor: unknown): { ok: true; mes: string } | { ok: false; error: string } {
  const s = typeof valor === "string" ? valor.trim() : "";
  if (!MES_RE.test(s)) return { ok: false, error: "El mes tiene que venir como AAAA-MM." };
  return { ok: true, mes: s };
}

/**
 * Rango de fechas de un mes, como `[desde, hasta)` en UTC. Se usa para filtrar
 * `CierreTurno.fecha`, que es un DATE a medianoche UTC.
 */
export function rangoMes(mes: string): { desde: Date; hasta: Date } {
  const [anio, m] = mes.split("-").map((x) => Number.parseInt(x, 10));
  const desde = new Date(Date.UTC(anio, m - 1, 1));
  const hasta = new Date(Date.UTC(m === 12 ? anio + 1 : anio, m === 12 ? 0 : m, 1));
  return { desde, hasta };
}

/** Mes anterior a uno dado, para comparar con el cierre del mes pasado. */
export function mesAnterior(mes: string): string {
  const [anio, m] = mes.split("-").map((x) => Number.parseInt(x, 10));
  const y = m === 1 ? anio - 1 : anio;
  const mm = m === 1 ? 12 : m - 1;
  return `${y}-${String(mm).padStart(2, "0")}`;
}

/** Cantidad de un objetivo: entero, no negativa. 0 = borrar el objetivo. */
export function normalizarCantidadObjetivo(
  valor: unknown,
): { ok: true; cantidad: number } | { ok: false; error: string } {
  const n =
    typeof valor === "number"
      ? valor
      : typeof valor === "string"
        ? Number.parseInt(valor.trim(), 10)
        : Number.NaN;
  if (!Number.isInteger(n) || n < 0) return { ok: false, error: "El objetivo tiene que ser un número entero de unidades." };
  if (n > OBJETIVO_MAX) return { ok: false, error: "Ese objetivo no parece realista." };
  return { ok: true, cantidad: n };
}

/**
 * Ámbito de un objetivo. Exige exactamente uno de los dos destinatarios: un
 * objetivo de "todos" no se puede repartir, y uno de comercial Y sede a la vez
 * se contaría dos veces al sumar.
 */
export function ambitoDe(o: {
  userId?: string | null;
  tiendaId?: string | null;
}): AmbitoObjetivo | null {
  const tieneUser = Boolean(o.userId);
  const tieneTienda = Boolean(o.tiendaId);
  if (tieneUser === tieneTienda) return null;
  return tieneUser ? "comercial" : "sede";
}

/**
 * Unidades que cuentan para un objetivo: las del comercial o las de la sede, y
 * si el objetivo es de un artículo concreto, solo las de ese artículo.
 *
 * Las ventas cuyo artículo se borró del catálogo (`articuloId = null`) suman en
 * los objetivos de unidades totales pero no en los de un artículo: se vendió
 * algo, aunque ya no sepamos qué.
 */
export function vendidoPara(objetivo: ObjetivoFila, ventas: VentaAgregada[]): number {
  return ventas.reduce((total, v) => {
    if (objetivo.userId && v.userId !== objetivo.userId) return total;
    if (objetivo.tiendaId && v.tiendaId !== objetivo.tiendaId) return total;
    if (objetivo.articuloId && v.articuloId !== objetivo.articuloId) return total;
    return total + v.cantidad;
  }, 0);
}

/**
 * Porcentaje de consecución, redondeado a un decimal. Sin objetivo devuelve
 * null (misma regla que `core.consecucion`, que es la que usa el resto del
 * módulo).
 */
function pct(vendido: number, objetivo: number): number | null {
  if (!Number.isFinite(objetivo) || objetivo <= 0) return null;
  return Math.round((vendido / objetivo) * 1000) / 10;
}

/** Cruza los objetivos del mes con las ventas y devuelve una fila por objetivo. */
export function construirConsecucion(
  objetivos: ObjetivoFila[],
  ventas: VentaAgregada[],
): FilaConsecucion[] {
  const filas: FilaConsecucion[] = [];
  for (const o of objetivos) {
    const ambito = ambitoDe(o);
    if (!ambito) continue; // dato corrupto: mejor no pintarlo que pintarlo mal
    const vendido = vendidoPara(o, ventas);
    filas.push({
      objetivoId: o.id,
      ambito,
      sujetoId: (ambito === "comercial" ? o.userId : o.tiendaId) as string,
      articuloId: o.articuloId,
      objetivo: o.cantidad,
      vendido,
      consecucion: pct(vendido, o.cantidad),
    });
  }
  return filas;
}

/**
 * Unidades vendidas de un sujeto (comercial o sede), opcionalmente de un solo
 * artículo. Es lo que necesita la tabla de fijar objetivos para mostrar el
 * "vendido" al lado de cada casilla, incluso donde todavía no hay objetivo.
 */
export function vendidoDeSujeto(
  ventas: VentaAgregada[],
  sujeto: { ambito: AmbitoObjetivo; id: string },
  articuloId: string | null,
): number {
  return vendidoPara(
    {
      id: "",
      mes: "",
      userId: sujeto.ambito === "comercial" ? sujeto.id : null,
      tiendaId: sujeto.ambito === "sede" ? sujeto.id : null,
      articuloId,
      cantidad: 0,
    },
    ventas,
  );
}

/**
 * Importe vendido, cuando el cliente trabaja con precios. Los artículos sin
 * precio suman 0 € y se cuentan aparte: es mejor decir "faltan precios en 3
 * artículos" que dar un total en euros que nadie va a poder cuadrar.
 */
export function importeVendido(
  ventas: VentaAgregada[],
  precios: Map<string, number | null>,
): { importe: number; unidadesSinPrecio: number } {
  let importe = 0;
  let unidadesSinPrecio = 0;
  for (const v of ventas) {
    const p = v.articuloId ? precios.get(v.articuloId) : null;
    if (p === null || p === undefined) {
      unidadesSinPrecio += v.cantidad;
      continue;
    }
    importe += p * v.cantidad;
  }
  return { importe: Math.round(importe * 100) / 100, unidadesSinPrecio };
}

/**
 * Resumen del paso 2 del asistente: cómo va el comercial y cómo va su sede.
 * Se calcula sobre el mes en curso, que es lo que el objetivo mide.
 */
export interface ProgresoPaso2 {
  vendido: number;
  objetivo: number | null;
  consecucion: number | null;
}

export function progresoDe(
  objetivos: ObjetivoFila[],
  ventas: VentaAgregada[],
  sujeto: { ambito: AmbitoObjetivo; id: string },
): ProgresoPaso2 {
  const vendido = vendidoDeSujeto(ventas, sujeto, null);
  // Solo cuenta el objetivo de unidades totales: mezclarlo con los de un
  // artículo concreto daría un "objetivo" que no significa nada.
  const suyo = objetivos.find(
    (o) =>
      o.articuloId === null &&
      (sujeto.ambito === "comercial" ? o.userId === sujeto.id : o.tiendaId === sujeto.id),
  );
  const objetivo = suyo?.cantidad ?? null;
  return { vendido, objetivo, consecucion: objetivo === null ? null : pct(vendido, objetivo) };
}
