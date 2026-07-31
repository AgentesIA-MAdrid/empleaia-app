/**
 * Seguimiento diario de los objetivos de venta — lógica pura.
 *
 * Los objetivos son mensuales (ver `objetivos.ts`), pero se miran cada día:
 * "vamos por 120 de 300 a día 12, ¿llegamos?". Esa es la pregunta que
 * responden estas funciones, sin Prisma ni red, igual que el resto del módulo.
 *
 * Reglas del seguimiento, para no repetirlas en cada pantalla:
 *  - El **concepto** es lo que se está siguiendo: las unidades totales, un
 *    grupo de productos o un producto suelto. Es el mismo modelo de columnas
 *    de la parrilla de definición (`objetivos.ts`), pero aquí se mira uno cada
 *    vez, porque la tabla de seguimiento es día a día y no cabe todo.
 *  - El **día de corte** es hasta dónde se cuenta. Por omisión, hoy; si se mira
 *    un mes ya cerrado, su último día. Nunca se cuenta más allá del mes.
 *  - El **objetivo a día de hoy** es el reparto lineal del objetivo del mes
 *    entre sus días (objetivo × días transcurridos / días del mes). No es una
 *    previsión fina —nadie vende igual un martes que un sábado—, es la
 *    referencia que usa todo el mundo en su Excel para saber si va por delante
 *    o por detrás.
 *  - La **desviación** es lo vendido menos ese objetivo al día: positiva, va
 *    sobrado; negativa, va corto.
 *  - El **ritmo necesario** son las unidades por día que quedan por vender para
 *    llegar a fin de mes. Con el objetivo ya cumplido es 0, y el último día del
 *    mes (sin días por delante) no se puede calcular: null.
 */

import {
  ambitoDe,
  columnaCategoria,
  objetivoTotalDe,
  PREFIJO_CATEGORIA,
  vendidoPara,
  type AmbitoObjetivo,
  type ArticuloObjetivo,
  type ObjetivoFila,
  type VentaAgregada,
  type VentaDia,
} from "@/lib/cierre-turno/objetivos";

/** Qué se está siguiendo: todo, un grupo de productos o un producto. */
export type TipoConcepto = "total" | "grupo" | "articulo";

export interface Concepto {
  /** Id de la columna: "" (unidades totales), "cat:<grupo>" o el id del artículo. */
  id: string;
  tipo: TipoConcepto;
  categoria: string | null;
  articuloId: string | null;
  /** Cómo se llama en pantalla y en el nombre del fichero exportado. */
  etiqueta: string;
}

export const CONCEPTO_TOTAL: Concepto = {
  id: "",
  tipo: "total",
  categoria: null,
  articuloId: null,
  etiqueta: "Unidades totales",
};

/**
 * Traduce el concepto pedido por querystring. Uno que ya no existe (un grupo
 * que se quedó sin productos, un artículo retirado) cae en unidades totales en
 * vez de dar error: la pantalla se sigue viendo y el desplegable ya enseña que
 * la selección ha vuelto al total.
 */
export function normalizarConcepto(
  valor: unknown,
  catalogo: { id: string; nombre: string; categoria: string | null }[],
  categorias: string[],
): Concepto {
  const id = typeof valor === "string" ? valor.trim() : "";
  if (!id) return CONCEPTO_TOTAL;
  if (id.startsWith(PREFIJO_CATEGORIA)) {
    const categoria = id.slice(PREFIJO_CATEGORIA.length);
    if (!categorias.includes(categoria)) return CONCEPTO_TOTAL;
    return { id: columnaCategoria(categoria), tipo: "grupo", categoria, articuloId: null, etiqueta: categoria };
  }
  const articulo = catalogo.find((a) => a.id === id);
  if (!articulo) return CONCEPTO_TOTAL;
  return { id, tipo: "articulo", categoria: null, articuloId: id, etiqueta: articulo.nombre };
}

/** Días que tiene un mes "YYYY-MM". */
export function diasDelMes(mes: string): number {
  const [anio, m] = mes.split("-").map((x) => Number.parseInt(x, 10));
  // Día 0 del mes siguiente = último día de este.
  return new Date(Date.UTC(anio, m, 0)).getUTCDate();
}

/** Día del mes de una fecha "YYYY-MM-DD" (1..31). */
export function diaDelMes(fecha: string): number {
  return Number.parseInt(fecha.slice(8, 10), 10);
}

/** Fecha "YYYY-MM-DD" del día `n` de un mes. */
export function fechaDelDia(mes: string, dia: number): string {
  return `${mes}-${String(dia).padStart(2, "0")}`;
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Día hasta el que se cuenta. Se acota siempre al mes que se está mirando:
 *  - Mes en curso → hoy (o el día pedido, si cae dentro).
 *  - Mes ya pasado → su último día, que es el cierre real de ese mes.
 *  - Mes futuro → su primer día, con cero días transcurridos.
 */
export function normalizarDiaCorte(mes: string, valor: unknown, hoy: string): string {
  const ultimo = fechaDelDia(mes, diasDelMes(mes));
  const primero = fechaDelDia(mes, 1);
  const tope = hoy < ultimo ? hoy : ultimo;
  const pedido = typeof valor === "string" && FECHA_RE.test(valor.trim()) ? valor.trim() : null;
  const dia = pedido ?? tope;
  if (dia < primero) return primero;
  return dia > tope ? tope : dia;
}

/** Cómo va de avanzado el mes en el día de corte. */
export interface ProgresoMes {
  mes: string;
  /** Día hasta el que se cuenta, "YYYY-MM-DD". */
  corte: string;
  dias: number;
  transcurridos: number;
  restantes: number;
}

/**
 * `hoy` sirve para el mes que todavía no ha empezado: su corte se queda en el
 * día 1 (hay que enseñar una fecha), pero no ha transcurrido ningún día y no
 * tendría sentido pedirle ya 1/31 del objetivo.
 */
export function progresoDelMes(mes: string, corte: string, hoy?: string): ProgresoMes {
  const dias = diasDelMes(mes);
  const primerDia = fechaDelDia(mes, 1);
  const empezado = (hoy ?? corte) >= primerDia;
  const transcurridos = empezado ? Math.min(diaDelMes(corte), dias) : 0;
  return { mes, corte, dias, transcurridos, restantes: Math.max(0, dias - transcurridos) };
}

/** Consecución con la misma regla que el resto del módulo (sin objetivo, null). */
function pct(vendido: number, objetivo: number | null): number | null {
  if (objetivo === null || objetivo <= 0) return null;
  return Math.round((vendido / objetivo) * 1000) / 10;
}

const dec1 = (n: number) => Math.round(n * 10) / 10;

/** Objetivo del sujeto para el concepto que se está siguiendo. */
export function objetivoDelConcepto(
  objetivosDelSujeto: ObjetivoFila[],
  concepto: Concepto,
  articuloIds?: string[],
  catalogo?: ArticuloObjetivo[],
): number | null {
  if (concepto.tipo === "total") {
    // Misma regla que la parrilla: el fijado a mano o, si no hay, la suma de
    // los de cada grupo y producto suelto.
    return objetivoTotalDe(objetivosDelSujeto, articuloIds, catalogo).cantidad;
  }
  const suyo = objetivosDelSujeto.find((o) =>
    concepto.tipo === "grupo"
      ? !o.articuloId && (o.categoria ?? null) === concepto.categoria
      : o.articuloId === concepto.articuloId,
  );
  return suyo ? suyo.cantidad : null;
}

/** Unidades que cuentan para ese concepto (mismas reglas que `vendidoPara`). */
export function vendidoDelConcepto(
  ventas: VentaAgregada[],
  sujeto: { ambito: AmbitoObjetivo; id: string },
  concepto: Concepto,
): number {
  return vendidoPara(
    {
      id: "",
      mes: "",
      userId: sujeto.ambito === "comercial" ? sujeto.id : null,
      tiendaId: sujeto.ambito === "sede" ? sujeto.id : null,
      articuloId: concepto.articuloId,
      categoria: concepto.categoria,
      cantidad: 0,
    },
    ventas,
  );
}

/** Una fila de la tabla de seguimiento: un comercial o un punto de venta. */
export interface FilaSeguimiento {
  sujetoId: string;
  sujeto: string;
  /** Sede del comercial. null en las filas de sede. */
  sede: string | null;
  objetivo: number | null;
  /** Parte del objetivo que tocaría llevar a día de corte (reparto lineal). */
  objetivoAlDia: number | null;
  vendido: number;
  /** Lo vendido el propio día de corte, para ver el día suelto. */
  vendidoDelDia: number;
  /** Vendido − objetivo al día. Positiva va por delante, negativa por detrás. */
  desviacion: number | null;
  consecucion: number | null;
  mediaDiaria: number;
  /** Unidades por día que quedan para llegar a fin de mes. */
  ritmoNecesario: number | null;
  /** A este ritmo, cuánto se cerraría el mes. */
  prevision: number | null;
}

/** Las cifras derivadas de un objetivo y lo vendido, a día de corte. */
export function metricasDe(
  objetivo: number | null,
  vendido: number,
  progreso: ProgresoMes,
): Pick<
  FilaSeguimiento,
  "objetivoAlDia" | "desviacion" | "consecucion" | "mediaDiaria" | "ritmoNecesario" | "prevision"
> {
  const objetivoAlDia =
    objetivo === null ? null : Math.round((objetivo * progreso.transcurridos) / progreso.dias);
  const mediaDiaria = progreso.transcurridos > 0 ? dec1(vendido / progreso.transcurridos) : 0;
  const falta = objetivo === null ? null : Math.max(0, objetivo - vendido);
  return {
    objetivoAlDia,
    desviacion: objetivoAlDia === null ? null : vendido - objetivoAlDia,
    consecucion: pct(vendido, objetivo),
    mediaDiaria,
    // Sin días por delante no hay ritmo que pedir: el mes ya está cerrado.
    ritmoNecesario: falta === null || progreso.restantes === 0 ? null : dec1(falta / progreso.restantes),
    prevision: progreso.transcurridos > 0 ? Math.round(mediaDiaria * progreso.dias) : null,
  };
}

/**
 * Filas de seguimiento de un ámbito (comerciales o sedes).
 *
 * Las ventas se reparten por sujeto en un solo recorrido: la tabla tiene tantas
 * filas como personas y recorrer todas las ventas en cada una multiplica el
 * trabajo sin necesidad (mismo motivo que `indexarVentas` en `objetivos.ts`).
 */
export function construirSeguimiento(args: {
  ambito: AmbitoObjetivo;
  sujetos: { id: string; nombre: string; sede?: string | null }[];
  objetivos: ObjetivoFila[];
  ventas: VentaDia[];
  concepto: Concepto;
  progreso: ProgresoMes;
  articuloIds?: string[];
  catalogo?: ArticuloObjetivo[];
}): FilaSeguimiento[] {
  const { ambito, concepto, progreso } = args;

  const ventasPorSujeto = new Map<string, VentaDia[]>();
  for (const v of args.ventas) {
    const sujetoId = ambito === "comercial" ? v.userId : v.tiendaId;
    if (!sujetoId) continue;
    const lista = ventasPorSujeto.get(sujetoId);
    if (lista) lista.push(v);
    else ventasPorSujeto.set(sujetoId, [v]);
  }

  const objetivosPorSujeto = new Map<string, ObjetivoFila[]>();
  for (const o of args.objetivos) {
    // Un objetivo del otro ámbito no pinta nada aquí: los personales y los de
    // la sede son objetivos distintos y no se mezclan.
    if (ambitoDe(o) !== ambito) continue;
    const sujetoId = (ambito === "comercial" ? o.userId : o.tiendaId) as string;
    const suyos = objetivosPorSujeto.get(sujetoId);
    if (suyos) suyos.push(o);
    else objetivosPorSujeto.set(sujetoId, [o]);
  }

  return args.sujetos.map((s) => {
    const suyas = ventasPorSujeto.get(s.id) ?? [];
    const objetivo = objetivoDelConcepto(
      objetivosPorSujeto.get(s.id) ?? [],
      concepto,
      args.articuloIds,
      args.catalogo,
    );
    const vendido = vendidoDelConcepto(suyas, { ambito, id: s.id }, concepto);
    const vendidoDelDia = vendidoDelConcepto(
      suyas.filter((v) => v.fecha === progreso.corte),
      { ambito, id: s.id },
      concepto,
    );
    return {
      sujetoId: s.id,
      sujeto: s.nombre,
      sede: s.sede ?? null,
      objetivo,
      vendido,
      vendidoDelDia,
      ...metricasDe(objetivo, vendido, progreso),
    };
  });
}

/** Pie de la tabla: la suma de las filas, con sus cifras recalculadas. */
export function totalesSeguimiento(
  filas: FilaSeguimiento[],
  progreso: ProgresoMes,
): Omit<FilaSeguimiento, "sujetoId" | "sujeto" | "sede"> & { conObjetivo: number; cumplen: number } {
  let objetivo = 0;
  let conObjetivo = 0;
  let cumplen = 0;
  let vendido = 0;
  let vendidoDelDia = 0;
  for (const f of filas) {
    vendido += f.vendido;
    vendidoDelDia += f.vendidoDelDia;
    if (f.objetivo === null || f.objetivo <= 0) continue;
    objetivo += f.objetivo;
    conObjetivo += 1;
    if ((f.consecucion ?? 0) >= 100) cumplen += 1;
  }
  // Sin ninguna fila con objetivo no se enseña un objetivo de 0: "sin objetivo"
  // y "objetivo de cero unidades" no son lo mismo (misma regla que la parrilla).
  const objetivoTotal = conObjetivo > 0 ? objetivo : null;
  return {
    objetivo: objetivoTotal,
    vendido,
    vendidoDelDia,
    conObjetivo,
    cumplen,
    ...metricasDe(objetivoTotal, vendido, progreso),
  };
}

/** Un día de la serie de seguimiento. */
export interface PuntoSerie {
  fecha: string;
  vendido: number;
  acumulado: number;
  /** Lo que tocaría llevar acumulado ese día (reparto lineal del objetivo). */
  objetivoAcumulado: number | null;
  desviacion: number | null;
  consecucion: number | null;
}

/**
 * Día a día del mes hasta el corte: lo vendido cada día, el acumulado y la
 * comparación con el objetivo repartido. Es la lectura de "¿cuándo nos hemos
 * descolgado?", que en una tabla por comercial no se ve.
 *
 * Se pintan todos los días transcurridos, también los de cero ventas: un día
 * en blanco es información (festivo, tienda cerrada, nadie fichó cierre).
 */
export function serieDiaria(args: {
  ventas: VentaDia[];
  concepto: Concepto;
  objetivo: number | null;
  progreso: ProgresoMes;
}): PuntoSerie[] {
  const { progreso, concepto, objetivo } = args;
  const porDia = new Map<string, VentaDia[]>();
  for (const v of args.ventas) {
    const lista = porDia.get(v.fecha);
    if (lista) lista.push(v);
    else porDia.set(v.fecha, [v]);
  }

  const puntos: PuntoSerie[] = [];
  let acumulado = 0;
  for (let dia = 1; dia <= progreso.transcurridos; dia++) {
    const fecha = fechaDelDia(progreso.mes, dia);
    // El sujeto da igual: las ventas ya llegan acotadas por los filtros.
    const vendido = vendidoPara(
      {
        id: "",
        mes: "",
        userId: null,
        tiendaId: null,
        articuloId: concepto.articuloId,
        categoria: concepto.categoria,
        cantidad: 0,
      },
      porDia.get(fecha) ?? [],
    );
    acumulado += vendido;
    const objetivoAcumulado = objetivo === null ? null : Math.round((objetivo * dia) / progreso.dias);
    puntos.push({
      fecha,
      vendido,
      acumulado,
      objetivoAcumulado,
      desviacion: objetivoAcumulado === null ? null : acumulado - objetivoAcumulado,
      consecucion: pct(acumulado, objetivo),
    });
  }
  return puntos;
}
