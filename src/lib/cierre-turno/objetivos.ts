/**
 * Objetivos de venta — lógica pura (entrega 3 del módulo "Cierre de turno").
 *
 * Sin Prisma ni red: el handler lee objetivos y ventas agregadas, y estas
 * funciones deciden qué cuenta para qué objetivo y cuánto se lleva conseguido.
 * Igual que `core.ts`, así se prueba sin base de datos.
 *
 * Reglas del modelo, para no repetirlas en cada pantalla:
 *  - Un objetivo es de UN comercial, de UNA sede o de UN grupo de objetivos
 *    (el ámbito "grupo": TMT, televenta…, definido por el cliente), nunca de
 *    dos a la vez.
 *  - Un objetivo es de un producto (`articuloId`), de un grupo de productos
 *    (`subcategoria`, la del catálogo) o de unidades totales (los dos a null).
 *    El grupo es la SUBCATEGORÍA: la categoría organiza el catálogo y sale en
 *    los informes, pero no es un nivel sobre el que se fijen objetivos
 *    (ticket 234c6b0f). Un grupo se identifica por su subcategoría Y su
 *    categoría, porque la misma subcategoría ("Pospago") puede colgar de dos
 *    categorías distintas y son dos grupos distintos.
 *  - Un producto marcado como que no cuenta para objetivos
 *    (`ArticuloVenta.cuentaParaObjetivos = false`) se sigue vendiendo y
 *    registrando, pero sus unidades no empujan ni el objetivo de unidades
 *    totales ni el de su grupo: el cliente decide qué se persigue.
 *  - Sin `articuloId`, el objetivo es de unidades totales (todo el catálogo).
 *    Si no se ha fijado a mano, sale de sumar los de cada producto: quien
 *    rellena la parrilla producto a producto espera que el total cuadre con lo
 *    que ha puesto, no un total aparte que se queda a cero (ver
 *    `objetivoTotalDe`).
 *  - El objetivo de una sede se compara con lo que vendió la sede completa,
 *    no con la suma de los objetivos de sus comerciales: son dos formas de
 *    apretar y el cliente usa la que quiere en cada momento. Lo mismo vale
 *    para el de un grupo de objetivos: se compara con lo que vendieron sus
 *    miembros, contando cada venta una sola vez.
 *
 * Ojo con la palabra "grupo", que aquí significa dos cosas distintas:
 *  - `subcategoria` (+ su `categoria`) = grupo de PRODUCTOS, un bloque del
 *    catálogo. Es de qué va el objetivo.
 *  - `grupoId` = grupo de OBJETIVOS (`GrupoObjetivo`: TMT, televenta…). Es a
 *    quién va dirigido, igual que `userId` o `tiendaId`.
 */

import { claveArticulo } from "@/lib/cierre-turno/catalogo";

export type AmbitoObjetivo = "comercial" | "sede" | "grupo";

/** Objetivo tal como sale de la tabla, con lo justo para calcular. */
export interface ObjetivoFila {
  id: string;
  mes: string;
  userId: string | null;
  tiendaId: string | null;
  /** Objetivo dirigido a un grupo de objetivos (TMT, televenta…). */
  grupoId?: string | null;
  articuloId: string | null;
  /** Objetivo de un grupo de productos (la subcategoría del catálogo). */
  subcategoria?: string | null;
  /** Categoría de esa subcategoría: sin ella, dos grupos homónimos se mezclan. */
  categoria?: string | null;
  /**
   * Quién impone la cifra: la empresa (`propio`) o el operador (`tmt`). Son dos
   * objetivos distintos sobre la misma tienda y las mismas ventas, así que no se
   * mezclan nunca en la misma parrilla (ticket 5d8b21c7). Sin valor, `propio`.
   */
  fuente?: FuenteObjetivo;
  cantidad: number;
}

/**
 * De quién es un objetivo. `tmt` es el que manda el operador para cada punto de
 * venta; `propio`, el que fija la empresa.
 */
export type FuenteObjetivo = "propio" | "tmt";

/** La fuente de un objetivo, con `propio` como valor por omisión. */
export function fuenteDe(o: { fuente?: FuenteObjetivo | null }): FuenteObjetivo {
  return o.fuente === "tmt" ? "tmt" : "propio";
}

/**
 * Ventas del mes ya agrupadas por comercial, sede y artículo. `tiendaId` es la
 * sede del cierre (la que tenía el comercial ese día), no la actual del
 * empleado: si alguien cambia de tienda a mitad de mes, lo vendido se queda
 * donde se vendió.
 *
 * `categoria`, `subcategoria` y `cuentaParaObjetivos` los rellena `anotarVentas`
 * con el catálogo: sin ellos la venta cuenta para todo, que es como se
 * comportaba el módulo antes de los objetivos por grupo.
 */
export interface VentaAgregada {
  userId: string;
  tiendaId: string | null;
  articuloId: string | null;
  cantidad: number;
  /** Categoría del artículo vendido. null = sin categoría o artículo retirado. */
  categoria?: string | null;
  /** Grupo del artículo vendido. null = sin subcategoría o artículo retirado. */
  subcategoria?: string | null;
  /** false = el artículo está marcado como que no cuenta para objetivos. */
  cuentaParaObjetivos?: boolean;
  /**
   * Grupos de objetivos en los que cae esta venta (por el comercial o por la
   * sede). Lo rellena `anotarVentas`; sin grupos, ninguna venta cae en ninguno.
   */
  grupoIds?: string[];
}

/** Un grupo de objetivos con sus miembros, para repartir las ventas. */
export interface GrupoObjetivoResumen {
  id: string;
  nombre: string;
  /** Comerciales del grupo. */
  userIds: string[];
  /** Puntos de venta del grupo. */
  tiendaIds: string[];
}

/**
 * Lo mismo, pero sin colapsar el día: es lo que necesita el seguimiento diario
 * ("¿cuándo nos hemos descolgado?"). `fecha` es el día del cierre, "YYYY-MM-DD".
 */
export interface VentaDia extends VentaAgregada {
  fecha: string;
}

/** Lo que los objetivos necesitan saber de cada artículo del catálogo. */
export interface ArticuloObjetivo {
  id: string;
  categoria: string | null;
  /** Su grupo a efectos de objetivos. null = no está en ninguno. */
  subcategoria?: string | null;
  /** Por omisión cuenta: es el valor por defecto de la columna. */
  cuentaParaObjetivos?: boolean;
}

/** ¿Este artículo empuja los objetivos de unidades totales y de su grupo? */
export function cuentaParaObjetivos(a: ArticuloObjetivo): boolean {
  return a.cuentaParaObjetivos !== false;
}

/**
 * Marca cada venta con el grupo de su artículo, con si ese artículo cuenta
 * para los objetivos y con los grupos de objetivos en los que cae. Se hace una
 * vez, al leer las ventas, para que el resto de funciones sigan siendo puras y
 * no tengan que arrastrar el catálogo ni la composición de los grupos.
 *
 * Una venta de un artículo que ya no está en el catálogo activo se queda sin
 * grupo y contando: se vendió algo, aunque ya no sepamos qué (misma regla que
 * `vendidoPara` con `articuloId` null).
 *
 * Una venta cae en un grupo de objetivos si su comercial o su sede son miembros
 * del grupo, y cae UNA sola vez aunque lo sean los dos: si no, un grupo que
 * lleve una tienda y a su gente contaría el doble.
 */
export function anotarVentas<T extends VentaAgregada>(
  ventas: T[],
  articulos: ArticuloObjetivo[],
  grupos: GrupoObjetivoResumen[] = [],
  // Genérica a propósito: el seguimiento diario anota ventas que llevan además
  // la fecha y la sede del cierre, y necesita recuperarlas con esos campos
  // intactos. Devolver `VentaAgregada[]` los borraba del tipo.
): (T & VentaAgregada)[] {
  const porId = new Map(articulos.map((a) => [a.id, a]));
  const miembros = grupos.map((g) => ({
    id: g.id,
    userIds: new Set(g.userIds),
    tiendaIds: new Set(g.tiendaIds),
  }));
  return ventas.map((v) => {
    const a = v.articuloId ? porId.get(v.articuloId) : undefined;
    return {
      ...v,
      categoria: a?.categoria ?? null,
      subcategoria: a?.subcategoria ?? null,
      cuentaParaObjetivos: a ? cuentaParaObjetivos(a) : true,
      grupoIds: miembros
        .filter((g) => g.userIds.has(v.userId) || (v.tiendaId ? g.tiendaIds.has(v.tiendaId) : false))
        .map((g) => g.id),
    };
  });
}

/**
 * Un grupo de productos: **una subcategoría del catálogo**, y solo eso.
 *
 * La categoría (Particular, Empresa) no entra. Organiza el catálogo, sirve para
 * filtrar informes y el comercial la usa al registrar la venta, pero **no es un
 * nivel con objetivo propio** (ticket 528694fa): el objetivo se pone sobre la
 * subcategoría y lo empuja todo lo que cuelga de ella, venga de la categoría
 * que venga.
 *
 *   Empresa    → FFTH → Fibra 1 GB     ┐
 *   Empresa    → FFTH → Fibra General  │ los cuatro suman en el
 *   Particular → FFTH → Fibra 1 GB     │ objetivo del grupo FFTH
 *   Particular → FFTH → Fibra General  ┘
 *
 * Antes el grupo se identificaba por subcategoría + categoría, y eso partía la
 * parrilla en dos columnas por subcategoría —"FFTH · Particular" y "FFTH ·
 * Empresa"— con objetivos que había que fijar y cumplir por separado.
 */
export interface SubgrupoProductos {
  subcategoria: string;
}

/**
 * Columna de un grupo en la matriz. Lleva prefijo para no chocar con los ids de
 * artículo (cuids, que nunca llevan ":") ni con la columna de unidades totales.
 */
export const PREFIJO_SUBGRUPO = "sub:";

export function columnaSubgrupo(grupo: SubgrupoProductos): string {
  return `${PREFIJO_SUBGRUPO}${grupo.subcategoria}`;
}

/** El grupo que hay detrás de una columna, o null si la columna no es de grupo. */
export function subgrupoDeColumna(columna: string): SubgrupoProductos | null {
  if (!columna.startsWith(PREFIJO_SUBGRUPO)) return null;
  const subcategoria = columna.slice(PREFIJO_SUBGRUPO.length);
  if (!subcategoria) return null;
  return { subcategoria };
}

/** Cómo se llama un grupo en pantalla y en la hoja. */
export function etiquetaSubgrupo(grupo: SubgrupoProductos): string {
  return grupo.subcategoria;
}

/**
 * Grupos del catálogo (subcategorías con al menos un artículo que cuenta), en
 * el orden del catálogo: el primer artículo de cada bloque marca dónde va.
 *
 * Una subcategoría que aparece en varias categorías sale UNA sola vez: es un
 * único grupo con un único objetivo.
 */
export function subgruposDelCatalogo(articulos: ArticuloObjetivo[]): SubgrupoProductos[] {
  const vistos: SubgrupoProductos[] = [];
  const claves = new Set<string>();
  for (const a of articulos) {
    if (!a.subcategoria || !cuentaParaObjetivos(a)) continue;
    if (claves.has(a.subcategoria)) continue;
    claves.add(a.subcategoria);
    vistos.push({ subcategoria: a.subcategoria });
  }
  return vistos;
}

/**
 * ¿Este artículo (o esta venta) pertenece a ese grupo de productos? Solo cuenta
 * la subcategoría: la categoría de la que cuelgue da igual.
 */
export function esDelSubgrupo(
  articulo: { subcategoria?: string | null },
  grupo: SubgrupoProductos,
): boolean {
  return (articulo.subcategoria ?? null) === grupo.subcategoria;
}

/**
 * El grupo al que va dirigido un objetivo, o null si no es de un grupo.
 *
 * `ObjetivoVenta.categoria` se ignora a propósito: dejó de tener sentido al
 * dejar la categoría de ser un nivel con objetivo, y los objetivos fijados
 * antes la traen rellena y tienen que seguir contando igual.
 */
export function subgrupoDeObjetivo(o: { subcategoria?: string | null }): SubgrupoProductos | null {
  return o.subcategoria ? { subcategoria: o.subcategoria } : null;
}

/**
 * Cómo se mide un producto del catálogo en un mes dado:
 *
 *  - `producto`: hay un objetivo puesto sobre él, así que se persigue solo.
 *    Manda sobre todo lo demás, incluso sobre el interruptor de "cuenta para
 *    objetivos": un objetivo puesto sobre un artículo concreto sí mide sus
 *    ventas (ver `vendidoPara`).
 *  - `excluido`: marcado como que no cuenta y sin objetivo propio. No empuja
 *    ningún objetivo, ni el de unidades totales ni el de su grupo.
 *  - `grupo`: su subcategoría tiene objetivo, así que lo que venda empuja el
 *    del grupo entero (y el de unidades totales).
 *  - `total`: no hay objetivo ni suyo ni de su grupo; solo suma en el de
 *    unidades totales.
 */
export type ModoEvaluacion = "producto" | "grupo" | "total" | "excluido";

export interface EvaluacionArticulo {
  modo: ModoEvaluacion;
  /** El grupo que lo mide (su subcategoría), solo cuando `modo === "grupo"`. */
  grupo: SubgrupoProductos | null;
}

/**
 * Con qué se está midiendo un producto, para poder decirlo en la lista del
 * catálogo (ticket cd804fa2). Un objetivo puede ir sobre el producto o sobre su
 * grupo de productos —su subcategoría—, y desde el catálogo no había forma de
 * saber cuál de las dos cosas le pasa a cada uno.
 *
 * `objetivos` son los objetivos ya fijados del mes que se mira, sin distinguir
 * a quién van dirigidos: si alguien —un comercial, una sede o un grupo de
 * objetivos— persigue ese producto, el producto se está midiendo solo. Los
 * grupos llegan como columnas (`columnaSubgrupo`), que es lo que identifica a
 * uno sin ambigüedad.
 */
export function evaluacionDeArticulo(
  articulo: ArticuloObjetivo,
  objetivos: { articuloIds: ReadonlySet<string>; subgrupos: ReadonlySet<string> },
): EvaluacionArticulo {
  if (objetivos.articuloIds.has(articulo.id)) return { modo: "producto", grupo: null };
  if (!cuentaParaObjetivos(articulo)) return { modo: "excluido", grupo: null };
  if (articulo.subcategoria) {
    const grupo = { subcategoria: articulo.subcategoria };
    if (objetivos.subgrupos.has(columnaSubgrupo(grupo))) return { modo: "grupo", grupo };
  }
  return { modo: "total", grupo: null };
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

/** Tope del nombre de un grupo de objetivos ("TMT", "Televenta"…). */
export const GRUPO_NOMBRE_MAX = 60;

/**
 * Nombre de un grupo de objetivos tal y como se guarda. Devuelve el motivo del
 * rechazo en vez de un booleano: es el texto que ve quien lo está escribiendo
 * (mismo criterio que `normalizarNombreArticulo`).
 *
 * Dos letras de mínimo porque los grupos del cliente son siglas ("TMT"), no
 * frases; pedir más dejaría fuera nombres legítimos.
 */
export function normalizarNombreGrupo(
  bruto: unknown,
): { ok: true; nombre: string } | { ok: false; error: string } {
  const nombre = typeof bruto === "string" ? bruto.trim().replace(/\s+/g, " ") : "";
  if (nombre.length < 2) {
    return { ok: false, error: "Escribe el nombre del grupo (al menos 2 letras)." };
  }
  if (nombre.length > GRUPO_NOMBRE_MAX) {
    return { ok: false, error: `El nombre pasa de ${GRUPO_NOMBRE_MAX} caracteres.` };
  }
  return { ok: true, nombre };
}

/**
 * Clave con la que dos grupos se consideran el mismo: sin tildes, sin
 * mayúsculas y sin espacios de más. Evita tener "TMT" y "tmt" como dos grupos
 * distintos (misma idea que `claveArticulo` en el catálogo).
 */
export function claveGrupo(nombre: string): string {
  return (nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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
 * Ámbito de un objetivo. Exige exactamente uno de los tres destinatarios: un
 * objetivo de "todos" no se puede repartir, y uno de comercial Y sede (o
 * grupo) a la vez se contaría dos veces al sumar.
 */
export function ambitoDe(o: {
  userId?: string | null;
  tiendaId?: string | null;
  grupoId?: string | null;
}): AmbitoObjetivo | null {
  const puestos = [
    o.userId ? "comercial" : null,
    o.tiendaId ? "sede" : null,
    o.grupoId ? "grupo" : null,
  ].filter(Boolean) as AmbitoObjetivo[];
  return puestos.length === 1 ? puestos[0] : null;
}

/**
 * A quién va dirigido un objetivo: el id del comercial, de la sede o del grupo,
 * según su ámbito. Devuelve "" para un objetivo corrupto (sin destinatario o
 * con dos), que es lo que descartan los sitios que la usan.
 */
export function sujetoDeObjetivo(o: {
  userId?: string | null;
  tiendaId?: string | null;
  grupoId?: string | null;
}): string {
  const ambito = ambitoDe(o);
  if (ambito === "comercial") return o.userId as string;
  if (ambito === "sede") return o.tiendaId as string;
  if (ambito === "grupo") return o.grupoId as string;
  return "";
}

/**
 * Unidades que cuentan para un objetivo: las del comercial o las de la sede, y
 * si el objetivo es de un artículo concreto, solo las de ese artículo; si es de
 * un grupo, la suma de las de los artículos de esa subcategoría —que es cómo
 * pidió el cliente que puntúe un objetivo de grupo: el comercial registra
 * producto a producto y las cantidades se suman (ticket 234c6b0f).
 *
 * Las ventas cuyo artículo se borró del catálogo (`articuloId = null`) suman en
 * los objetivos de unidades totales pero no en los de un artículo ni en los de
 * un grupo: se vendió algo, aunque ya no sepamos qué.
 *
 * Los artículos marcados como que no cuentan para objetivos quedan fuera del
 * objetivo de unidades totales y del de su grupo (ver `anotarVentas`). Un
 * objetivo puesto sobre ese artículo concreto sí mide sus ventas: si alguien lo
 * fijó, es que lo persigue.
 */
export function vendidoPara(objetivo: ObjetivoFila, ventas: VentaAgregada[]): number {
  const grupo = subgrupoDeObjetivo(objetivo);
  return ventas.reduce((total, v) => {
    if (objetivo.userId && v.userId !== objetivo.userId) return total;
    if (objetivo.tiendaId && v.tiendaId !== objetivo.tiendaId) return total;
    // Un objetivo de grupo mide lo que vendieron sus miembros: `anotarVentas`
    // ya ha marcado en qué grupos cae cada venta.
    if (objetivo.grupoId && !(v.grupoIds ?? []).includes(objetivo.grupoId)) return total;
    if (objetivo.articuloId) {
      return v.articuloId === objetivo.articuloId ? total + v.cantidad : total;
    }
    if (v.cuentaParaObjetivos === false) return total;
    if (grupo && !esDelSubgrupo(v, grupo)) return total;
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
      sujetoId: sujetoDeObjetivo(o),
      articuloId: o.articuloId,
      objetivo: o.cantidad,
      vendido,
      consecucion: pct(vendido, o.cantidad),
    });
  }
  return filas;
}

/**
 * Unidades vendidas de un sujeto (comercial, sede o grupo de objetivos),
 * opcionalmente de un solo artículo. Es lo que necesita la tabla de fijar
 * objetivos para mostrar el "vendido" al lado de cada casilla, incluso donde
 * todavía no hay objetivo.
 */
export function vendidoDeSujeto(
  ventas: VentaAgregada[],
  sujeto: { ambito: AmbitoObjetivo; id: string },
  articuloId: string | null,
  grupo: SubgrupoProductos | null = null,
): number {
  return vendidoPara(
    {
      id: "",
      mes: "",
      userId: sujeto.ambito === "comercial" ? sujeto.id : null,
      tiendaId: sujeto.ambito === "sede" ? sujeto.id : null,
      grupoId: sujeto.ambito === "grupo" ? sujeto.id : null,
      articuloId,
      subcategoria: grupo?.subcategoria ?? null,
      cantidad: 0,
    },
    ventas,
  );
}

/** Columna de "unidades totales" en la matriz: el objetivo sin artículo. */
export const COLUMNA_TOTAL = "";

/**
 * Objetivo de unidades totales de un sujeto: el que se haya fijado a mano y,
 * si no hay ninguno, la suma de los que tenga producto a producto.
 *
 * El motivo: quien rellena la parrilla por producto (pospago, fibra…) da por
 * hecho que el total es la suma de lo que ha escrito. Pedirle además un total
 * aparte hacía que las cifras de arriba y el pie de la tabla enseñaran un 0 (o
 * un número que no cuadraba con la fila) teniendo la parrilla llena.
 *
 * Si el total sí está fijado, manda ese: es lo que ha puesto la persona, y
 * además significa "vende esto de lo que sea", incluso de lo que no tiene
 * columna propia.
 *
 * `articuloIds` acota qué productos suman (los del catálogo activo, que son las
 * columnas que se ven). Sin él suman todos los objetivos de artículo.
 *
 * Con objetivos de grupo la suma es "grupos + productos sueltos": el objetivo
 * de un producto que pertenece a un grupo que YA tiene objetivo no se suma
 * aparte, porque sus unidades ya las está pidiendo el grupo y contarlas dos
 * veces daría un total que nadie ha pedido. `catalogo` es el que dice a qué
 * grupo pertenece cada producto; sin él no hay objetivos de grupo que sumar.
 */
export function objetivoTotalDe(
  objetivosDelSujeto: ObjetivoFila[],
  articuloIds?: string[],
  catalogo?: ArticuloObjetivo[],
): { cantidad: number | null; derivado: boolean } {
  const fijado = objetivosDelSujeto.find(
    (o) => o.articuloId === null && !o.subcategoria && !o.categoria,
  );
  if (fijado) return { cantidad: fijado.cantidad, derivado: false };

  const grupoDe = new Map(
    (catalogo ?? []).map((a) => [
      a.id,
      a.subcategoria ? columnaSubgrupo({ subcategoria: a.subcategoria }) : "",
    ]),
  );
  const gruposVivos = catalogo
    ? new Set(subgruposDelCatalogo(catalogo).map((g) => columnaSubgrupo(g)))
    : null;
  const gruposConObjetivo = new Set(
    objetivosDelSujeto
      .map((o) => subgrupoDeObjetivo(o))
      .filter((g): g is SubgrupoProductos => g !== null)
      .map((g) => columnaSubgrupo(g))
      .filter((col) => !gruposVivos || gruposVivos.has(col)),
  );

  let suma = 0;
  let hay = false;
  for (const o of objetivosDelSujeto) {
    const grupo = subgrupoDeObjetivo(o);
    if (grupo) {
      // Un grupo que ya no existe en el catálogo no suma, igual que un producto
      // retirado: no tiene columna ni ventas que perseguir.
      if (!gruposConObjetivo.has(columnaSubgrupo(grupo))) continue;
      suma += o.cantidad;
      hay = true;
      continue;
    }
    if (o.articuloId === null) continue;
    if (articuloIds && !articuloIds.includes(o.articuloId)) continue;
    if (gruposConObjetivo.has(grupoDe.get(o.articuloId) ?? "")) continue;
    suma += o.cantidad;
    hay = true;
  }
  // Sin ningún objetivo por producto no se devuelve 0: "sin objetivo" y
  // "objetivo de cero unidades" no son lo mismo (ver `progresoDe`).
  return hay ? { cantidad: suma, derivado: true } : { cantidad: null, derivado: false };
}

/** Una casilla de la matriz: el objetivo fijado y cómo va. */
export interface CeldaObjetivo {
  objetivoId: string | null;
  objetivo: number | null;
  vendido: number;
  consecucion: number | null;
  /**
   * Solo en la columna de unidades totales: el objetivo no está fijado a mano,
   * es la suma de los de cada producto. La casilla se sigue pudiendo escribir
   * para poner un total distinto.
   */
  derivado?: boolean;
}

/** Una fila de la matriz: un comercial (o una sede) con una casilla por columna. */
export interface FilaMatriz {
  sujetoId: string;
  sujeto: string;
  /** Sede del comercial. null en las filas de sede. */
  sede: string | null;
  /** Casillas por columna: `COLUMNA_TOTAL` y el id de cada artículo. */
  celdas: Record<string, CeldaObjetivo>;
}

/** Totales de una columna, para el pie de cada tabla. */
export interface TotalColumna {
  objetivo: number;
  vendido: number;
  consecucion: number | null;
  /** Cuántas filas tienen objetivo fijado en esa columna. */
  conObjetivo: number;
}

/**
 * Unidades vendidas por sujeto y artículo, en un solo recorrido. La matriz
 * tiene comerciales × artículos casillas y recorrer las ventas en cada una
 * multiplica el trabajo sin necesidad.
 *
 * Las ventas de un artículo ya borrado del catálogo (`articuloId` null) suman
 * en la columna de unidades totales y en ninguna otra: misma regla que
 * `vendidoPara`. Las de un artículo que no cuenta para objetivos suman solo en
 * su propia columna, ni en el total ni en la de su grupo.
 */
function indexarVentas(ventas: VentaAgregada[], ambito: AmbitoObjetivo): Map<string, number> {
  const acc = new Map<string, number>();
  const suma = (clave: string, n: number) => acc.set(clave, (acc.get(clave) ?? 0) + n);
  for (const v of ventas) {
    // En el ámbito de grupo una misma venta puede caer en varios grupos (una
    // persona puede estar en más de uno); en los otros dos el sujeto es único.
    let sujetos: string[];
    if (ambito === "grupo") {
      sujetos = v.grupoIds ?? [];
    } else {
      const unico = ambito === "comercial" ? v.userId : v.tiendaId;
      sujetos = unico ? [unico] : [];
    }
    for (const sujetoId of sujetos) {
      if (v.cuentaParaObjetivos !== false) {
        suma(`${sujetoId}|${COLUMNA_TOTAL}`, v.cantidad);
        if (v.subcategoria) {
          const columna = columnaSubgrupo({ subcategoria: v.subcategoria });
          suma(`${sujetoId}|${columna}`, v.cantidad);
        }
      }
      if (v.articuloId) suma(`${sujetoId}|${v.articuloId}`, v.cantidad);
    }
  }
  return acc;
}

/** Columna de la matriz en la que cae un objetivo. */
export function columnaDeObjetivo(o: {
  articuloId?: string | null;
  subcategoria?: string | null;
  categoria?: string | null;
}): string {
  if (o.articuloId) return o.articuloId;
  const grupo = subgrupoDeObjetivo(o);
  return grupo ? columnaSubgrupo(grupo) : COLUMNA_TOTAL;
}

/**
 * Matriz de fijado de objetivos: una fila por comercial (o por sede, o por
 * grupo de objetivos) y una columna por grupo de productos y por artículo del
 * catálogo, más la de unidades totales.
 *
 * Los objetivos de los otros ámbitos se descartan aquí: los personales, los de
 * la sede y los del grupo son objetivos distintos y no se mezclan en la misma
 * tabla.
 *
 * `catalogo` trae el grupo de cada artículo; sin él no hay columnas de grupo
 * (es como se comportaba la parrilla antes de los objetivos por grupo).
 */
export function construirMatriz(
  ambito: AmbitoObjetivo,
  sujetos: { id: string; nombre: string; sede?: string | null }[],
  articuloIds: string[],
  objetivos: ObjetivoFila[],
  ventas: VentaAgregada[],
  catalogo?: ArticuloObjetivo[],
  /**
   * Qué juego de objetivos se pinta. La parrilla del operador y la de la
   * empresa hablan de las mismas tiendas y las mismas ventas, y solo se
   * diferencian en de quién es la cifra (ticket 5d8b21c7).
   */
  fuente: FuenteObjetivo = "propio",
): FilaMatriz[] {
  const vendidos = indexarVentas(ventas, ambito);

  const porClave = new Map<string, ObjetivoFila>();
  const porSujeto = new Map<string, ObjetivoFila[]>();
  for (const o of objetivos) {
    if (ambitoDe(o) !== ambito) continue;
    if (fuenteDe(o) !== fuente) continue;
    const sujetoId = sujetoDeObjetivo(o);
    porClave.set(`${sujetoId}|${columnaDeObjetivo(o)}`, o);
    const suyos = porSujeto.get(sujetoId);
    if (suyos) suyos.push(o);
    else porSujeto.set(sujetoId, [o]);
  }

  const subgrupos = catalogo ? subgruposDelCatalogo(catalogo) : [];
  const columnas = [COLUMNA_TOTAL, ...subgrupos.map(columnaSubgrupo), ...articuloIds];
  return sujetos.map((s) => {
    // Unidades totales: lo fijado a mano o, si no hay, la suma de los grupos y
    // los productos sueltos.
    const total = objetivoTotalDe(porSujeto.get(s.id) ?? [], articuloIds, catalogo);
    const celdas: Record<string, CeldaObjetivo> = {};
    for (const col of columnas) {
      const o = porClave.get(`${s.id}|${col}`) ?? null;
      const vendido = vendidos.get(`${s.id}|${col}`) ?? 0;
      const objetivo = col === COLUMNA_TOTAL ? total.cantidad : (o?.cantidad ?? null);
      celdas[col] = {
        objetivoId: o?.id ?? null,
        objetivo,
        vendido,
        consecucion: objetivo === null ? null : pct(vendido, objetivo),
        ...(col === COLUMNA_TOTAL && total.derivado ? { derivado: true } : {}),
      };
    }
    return { sujetoId: s.id, sujeto: s.nombre, sede: s.sede ?? null, celdas };
  });
}

/** Suma de cada columna de la matriz, para el pie de la tabla. */
export function totalesMatriz(
  filas: FilaMatriz[],
  articuloIds: string[],
  subgrupos: SubgrupoProductos[] = [],
): Record<string, TotalColumna> {
  const totales: Record<string, TotalColumna> = {};
  for (const col of [COLUMNA_TOTAL, ...subgrupos.map(columnaSubgrupo), ...articuloIds]) {
    let objetivo = 0;
    let vendido = 0;
    let conObjetivo = 0;
    for (const f of filas) {
      const c = f.celdas[col];
      if (!c) continue;
      objetivo += c.objetivo ?? 0;
      vendido += c.vendido;
      if (c.objetivo !== null) conObjetivo += 1;
    }
    totales[col] = { objetivo, vendido, consecucion: pct(vendido, objetivo), conObjetivo };
  }
  return totales;
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
  articuloIds?: string[],
  catalogo?: ArticuloObjetivo[],
): ProgresoPaso2 {
  const vendido = vendidoDeSujeto(ventas, sujeto, null);
  // El objetivo de unidades totales, con la misma regla que la parrilla de
  // administración: el fijado a mano y, si no hay, la suma de los de cada
  // producto. Así lo que administración escribe producto a producto se ve aquí
  // en vez de un "sin objetivo".
  const suyos = objetivos.filter(
    (o) => ambitoDe(o) === sujeto.ambito && sujetoDeObjetivo(o) === sujeto.id,
  );
  const { cantidad: objetivo } = objetivoTotalDe(suyos, articuloIds, catalogo);
  return { vendido, objetivo, consecucion: objetivo === null ? null : pct(vendido, objetivo) };
}

/** Una fila del desglose por producto del paso 2 ("Cómo vas"). */
export interface FilaProductoProgreso {
  /** El del primer producto de la fila: en pantalla solo sirve de clave. */
  articuloId: string;
  nombre: string;
  vendido: number;
  objetivo: number | null;
  consecucion: number | null;
  /** null cuando no hay precio con el que calcularlo (o están apagados). */
  importe: number | null;
  cuentaParaObjetivos: boolean;
  /** Productos del catálogo que suma esta fila. 1 = no se ha agrupado nada. */
  productos: number;
}

/**
 * Suma las filas de los productos que se llaman igual aunque estén en
 * categorías distintas (ticket 7dd7ac00).
 *
 * El catálogo los tiene como productos distintos —"Fibra 1 GB" de Particular y
 * "Fibra 1 GB" de Empresa son dos artículos, con su precio y sus objetivos— y
 * así se registran en el cierre, producto a producto. Pero al comercial se le
 * pide "vende 3 fibras", no "vende 3 fibras de particular": ver su venta
 * partida en dos filas con el mismo nombre le obliga a sumar de cabeza para
 * saber cómo va, y las dos filas parecen además un duplicado del catálogo.
 *
 * Se suman las unidades, los objetivos y el importe; la consecución se recalcula
 * con la suma, porque la media de dos porcentajes no es el porcentaje del total.
 * El nombre se compara con la misma clave que el catálogo (sin tildes, sin
 * mayúsculas y sin espacios de más), que es la que decide si dos artículos se
 * llaman igual en el resto del módulo.
 *
 * Solo agrupa lo que se le da: quien la llama ya ha decidido de quién son esas
 * ventas (las del propio comercial o las de su sede).
 */
export function agruparProductosPorNombre(filas: FilaProductoProgreso[]): FilaProductoProgreso[] {
  const acumuladas = new Map<string, FilaProductoProgreso>();
  for (const f of filas) {
    // Solo el nombre: la categoría y la subcategoría son justo lo que aquí da
    // igual (en `claveArticulo` van vacías si no se pasan).
    const clave = claveArticulo({ nombre: f.nombre });
    const previa = acumuladas.get(clave);
    if (!previa) {
      acumuladas.set(clave, { ...f, productos: 1 });
      continue;
    }
    previa.vendido += f.vendido;
    // "Sin objetivo" no es "objetivo de cero" (misma regla que el resto del
    // módulo): la suma solo existe si alguno de los productos tenía objetivo.
    if (f.objetivo !== null) previa.objetivo = (previa.objetivo ?? 0) + f.objetivo;
    // Un producto sin precio no anula el importe de sus hermanos, igual que en
    // `importeVendido`: aporta 0 € y el importe de la fila sigue siendo el que
    // se puede calcular.
    if (f.importe !== null) previa.importe = (previa.importe ?? 0) + f.importe;
    // Basta con que uno de los productos cuente para que la fila empuje los
    // objetivos; el aviso de "no cuenta" se queda para las filas en las que
    // ninguno cuenta, que es cuando sus unidades no aparecen arriba.
    previa.cuentaParaObjetivos = previa.cuentaParaObjetivos || f.cuentaParaObjetivos;
    previa.productos += 1;
  }
  // El orden es el de entrada (el del catálogo): manda el primer producto con
  // ese nombre, igual que en `subgruposDelCatalogo`.
  return [...acumuladas.values()].map((f) => ({
    ...f,
    importe: f.importe === null ? null : Math.round(f.importe * 100) / 100,
    consecucion: f.objetivo === null ? null : pct(f.vendido, f.objetivo),
  }));
}

/**
 * Objetivo propio de una coordinadora (ticket 73).
 *
 * El cliente lo definió así: *"tiene que salirles una tabla con su propio
 * objetivo, que se cumplirá en base a si sus sedes y los empleados asignados en
 * el turno a estas cumplen los objetivos"*. O sea: su objetivo no se fija a
 * mano, **es el de su zona**. Se calcula sumando el objetivo de unidades
 * totales de las sedes que lleva y comparándolo con lo que esas sedes han
 * vendido.
 *
 * Además se cuenta cuántas de sus sedes y cuántas de las personas de su equipo
 * llegan al 100 %, que es la lectura que le sirve para saber por dónde apretar:
 * un 95 % de zona puede ser "casi" o puede ser "dos tiendas sobradas y tres
 * muy lejos".
 *
 * Se calcula sobre las matrices ya construidas para no repetir consultas: la
 * columna de unidades totales de cada fila ya trae objetivo, vendido y
 * consecución con las reglas del módulo (incluido el total derivado).
 */
export interface ObjetivoCoordinacion {
  objetivo: number;
  vendido: number;
  consecucion: number | null;
  /** Sedes que llegan al 100 %, de las que tienen objetivo fijado. */
  sedesCumplen: number;
  sedesConObjetivo: number;
  /** Comerciales de su equipo que llegan al 100 %, de los que tienen objetivo. */
  comercialesCumplen: number;
  comercialesConObjetivo: number;
}

export function objetivoDeCoordinacion(args: {
  filasSedes: FilaMatriz[];
  filasComerciales: FilaMatriz[];
}): ObjetivoCoordinacion {
  const cumplen = (filas: FilaMatriz[]) => {
    let conObjetivo = 0;
    let alCien = 0;
    for (const f of filas) {
      const celda = f.celdas[COLUMNA_TOTAL];
      // Sin objetivo no se cuenta ni a favor ni en contra: una tienda a la que
      // nadie ha puesto cifra no puede contar como incumplida.
      if (!celda || celda.objetivo === null || celda.objetivo <= 0) continue;
      conObjetivo += 1;
      if ((celda.consecucion ?? 0) >= 100) alCien += 1;
    }
    return { conObjetivo, alCien };
  };

  let objetivo = 0;
  let vendido = 0;
  for (const f of args.filasSedes) {
    const celda = f.celdas[COLUMNA_TOTAL];
    if (!celda) continue;
    objetivo += celda.objetivo ?? 0;
    vendido += celda.vendido;
  }

  const sedes = cumplen(args.filasSedes);
  const comerciales = cumplen(args.filasComerciales);

  return {
    objetivo,
    vendido,
    consecucion: objetivo > 0 ? pct(vendido, objetivo) : null,
    sedesCumplen: sedes.alCien,
    sedesConObjetivo: sedes.conObjetivo,
    comercialesCumplen: comerciales.alCien,
    comercialesConObjetivo: comerciales.conObjetivo,
  };
}
