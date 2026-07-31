/**
 * Plantilla de objetivos de venta: qué columnas lleva la hoja, cómo se rellena
 * con lo que ya hay fijado y cómo se lee la que devuelve el cliente.
 *
 * Lógica pura, sin Prisma ni ficheros (igual que `catalogo.ts`): el handler
 * lee la base de datos y extrae las celdas del Excel, y esto decide qué es cada
 * columna, a quién va cada fila y qué cantidad vale. Así se prueba con tablas
 * de mentira, sin base de datos.
 *
 * Forma de la hoja:
 *
 *   Mes | 2026-07
 *   (fila en blanco)
 *   Ámbito | Comercial, punto de venta o grupo | Id | Unidades totales | Grupo: … | <producto> | …
 *   Comercial | Ana García | u_ana | 30 | 12 | 8 | …
 *   Sede      | Centro     | t1    | 90 |    |   | …
 *   Grupo     | TMT        | g_tmt | 200|    |   | …
 *
 * Ojo con la palabra "grupo", que en la hoja significa dos cosas: la columna
 * "Grupo: Pospago" es un grupo de PRODUCTOS (una subcategoría del
 * catálogo, con su categoría delante) y la fila con ámbito "Grupo" es un grupo
 * de OBJETIVOS (TMT, televenta…), o sea a quién va dirigido.
 *
 * Criterios, los mismos que en el resto del importador del módulo:
 *  - Ser tolerante con la hoja que vuelve: encabezados con o sin tildes,
 *    columnas movidas de sitio, filas en blanco y espacios de más.
 *  - Una casilla vacía **no toca** el objetivo que hubiera: la plantilla se
 *    rellena a medias muy a menudo y borrar lo que no se ha escrito sería
 *    destruir trabajo. Para quitar un objetivo se escribe 0, igual que en la
 *    parrilla de la pantalla.
 *  - Lo que no se entiende no se importa a medias: se cuenta como fila (o
 *    columna) ignorada y se le dice a quien sube el fichero.
 */

import {
  COLUMNA_TOTAL,
  PREFIJO_SUBGRUPO,
  ambitoDe,
  fuenteDe,
  type FuenteObjetivo,
  columnaDeObjetivo,
  columnaSubgrupo,
  cuentaParaObjetivos,
  etiquetaSubgrupo,
  normalizarCantidadObjetivo,
  subgrupoDeColumna,
  subgruposDelCatalogo,
  sujetoDeObjetivo,
  type AmbitoObjetivo,
  type ArticuloObjetivo,
  type ObjetivoFila,
} from "./objetivos";

/** Encabezados fijos de la hoja. */
export const CABECERA_AMBITO = "Ámbito";
export const CABECERA_SUJETO = "Comercial, punto de venta o grupo";
export const CABECERA_ID = "Id";
/** Etiqueta de la fila que dice de qué mes es la plantilla. */
export const ETIQUETA_MES = "Mes";
/** Título de la columna de unidades totales. */
export const TITULO_TOTAL = "Unidades totales";
/** Las columnas de grupo se titulan "Grupo: Telefonía" (el prefijo las delata). */
export const PREFIJO_GRUPO_HOJA = "Grupo: ";

/** Tope de objetivos que se aplican de una importación. */
export const PLANTILLA_MAX_CAMBIOS = 5000;

/** Artículo del catálogo, con lo que la plantilla necesita saber de él. */
export interface ArticuloPlantilla extends ArticuloObjetivo {
  nombre: string;
}

/** Una columna de objetivos de la hoja. */
export interface ColumnaPlantilla {
  /** Columna de la matriz: "" (totales), "sub:<grupo>" o el id del artículo. */
  id: string;
  titulo: string;
}

/** Un comercial, un punto de venta o un grupo: una fila de la hoja. */
export interface SujetoPlantilla {
  ambito: AmbitoObjetivo;
  id: string;
  nombre: string;
  /**
   * De quién es la cifra de esa fila. Un punto de venta baja DOS veces: la del
   * objetivo de la empresa y la del que impone el operador (ticket 5d8b21c7).
   */
  fuente?: FuenteObjetivo;
}

/** Objetivo a aplicar tras leer la hoja. `cantidad` 0 = quitar el objetivo. */
export interface CambioObjetivo {
  ambito: AmbitoObjetivo;
  sujetoId: string;
  articuloId: string | null;
  /** Grupo de productos del objetivo (subcategoría) y su categoría. */
  subcategoria: string | null;
  categoria: string | null;
  /** Quién impone la cifra: la empresa o el operador. */
  fuente: FuenteObjetivo;
  cantidad: number;
  /** Solo para poder explicarlo en el resumen. */
  sujeto: string;
  columna: string;
}

export interface LecturaPlantilla {
  /** La hoja tenía una fila de encabezados reconocible. */
  cabeceraEncontrada: boolean;
  /** Mes que traía escrito la hoja, si lo traía. */
  mes: string | null;
  cambios: CambioObjetivo[];
  /** Filas saltadas y por qué. */
  ignoradas: { fila: number; motivo: string }[];
  /** Columnas de la hoja que no hemos sabido casar con nada del catálogo. */
  columnasIgnoradas: { columna: string; motivo: string }[];
}

/**
 * Ámbito tal y como se escribe en la hoja. El objetivo del operador se
 * distingue en esta misma columna: la tienda baja dos veces y lo único que
 * cambia entre las dos filas es de quién es la cifra.
 */
export function textoAmbito(ambito: AmbitoObjetivo, fuente: FuenteObjetivo = "propio"): string {
  if (ambito === "sede") return fuente === "tmt" ? TEXTO_AMBITO_TMT : "Sede";
  if (ambito === "grupo") return "Grupo";
  return "Comercial";
}

/** Cómo se titula la fila del objetivo del operador. */
export const TEXTO_AMBITO_TMT = "TMT punto de venta";

/** Quita tildes, espacios de sobra y pasa a minúsculas (igual que `catalogo.ts`). */
function normalizar(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const CABECERAS_AMBITO = ["ambito", "tipo"];
const CABECERAS_SUJETO = [
  // La primera es la de hoy; las demás son plantillas de antes que la gente
  // sigue teniendo guardadas y que tienen que seguir importando igual.
  "comercial, punto de venta o grupo",
  "comercial o punto de venta",
  "comercial o sede",
  "comercial",
  "punto de venta",
  "sede",
  "nombre",
];
const CABECERAS_ID = ["id", "identificador"];
const TITULOS_TOTAL = ["unidades totales", "total", "totales", "unidades"];
const AMBITO_COMERCIAL = ["comercial", "empleado", "vendedor", "persona"];
const AMBITO_SEDE = ["sede", "punto de venta", "tienda"];
const AMBITO_GRUPO = ["grupo", "grupo de objetivos", "equipo"];
/**
 * Fila del objetivo del operador. Se aceptan varias formas de escribirlo porque
 * la hoja la rehace gente a mano y "TMT" a secas es como lo llaman ellos.
 */
const AMBITO_SEDE_TMT = [
  "tmt punto de venta",
  "tmt",
  "punto de venta (tmt)",
  "sede (tmt)",
  "sede tmt",
  "tmt sede",
  "tmt tienda",
];

/**
 * Columnas de objetivos de la plantilla: unidades totales, un grupo por
 * subcategoría del catálogo y un producto por artículo. Es el mismo orden que
 * las columnas de la parrilla de la pantalla, para que la hoja se lea igual.
 *
 * Los artículos que el cliente ha marcado como que no cuentan para objetivos no
 * tienen columna: no se les puede fijar objetivo (lo rechaza el endpoint) y
 * ofrecer la casilla sería invitar a rellenar algo que luego no se guarda.
 */
export function columnasPlantilla(articulos: ArticuloPlantilla[]): ColumnaPlantilla[] {
  const paraObjetivos = articulos.filter((a) => cuentaParaObjetivos(a));
  // Unidades totales y un grupo por subcategoría. Sin columna por producto: el
  // objetivo se fija por grupo y las ventas de sus productos lo empujan
  // (ticket 528694fa). Una hoja antigua con columnas de producto se sigue
  // pudiendo subir; esas columnas se ignoran y se dice por qué.
  return [
    { id: COLUMNA_TOTAL, titulo: TITULO_TOTAL },
    ...subgruposDelCatalogo(paraObjetivos).map((g) => ({
      id: columnaSubgrupo(g),
      titulo: `${PREFIJO_GRUPO_HOJA}${etiquetaSubgrupo(g)}`,
    })),
  ];
}

/**
 * Título de columna de cada artículo: su nombre y, si en el catálogo hay otro
 * que se llama igual, entre paréntesis dónde está.
 *
 * El mismo nombre en dos categorías son dos productos distintos y el cliente
 * puede tener los dos (ticket b4afccf5); si las dos columnas se titularan
 * igual, la hoja no se podría volver a importar sin adivinar a cuál de los dos
 * va cada cifra.
 */
function titulosDeArticulos(paraObjetivos: ArticuloPlantilla[]): Map<string, string> {
  const cuantos = new Map<string, number>();
  for (const a of paraObjetivos) {
    const clave = normalizar(a.nombre);
    cuantos.set(clave, (cuantos.get(clave) ?? 0) + 1);
  }
  return new Map(
    paraObjetivos.map((a) => {
      if ((cuantos.get(normalizar(a.nombre)) ?? 0) < 2) return [a.id, a.nombre] as const;
      const sitio = [a.categoria ?? "Sin categoría", a.subcategoria]
        .filter((x): x is string => Boolean(x))
        .join(" → ");
      return [a.id, `${a.nombre} (${sitio})`] as const;
    }),
  );
}

/**
 * Filas de la plantilla, ya rellenas con los objetivos fijados del mes.
 *
 * Solo se escribe lo que está fijado a mano: el total derivado (la suma de los
 * productos) se deja en blanco a propósito, porque devolverlo escrito lo
 * convertiría en un objetivo fijado y dejaría de moverse con la parrilla.
 */
export function filasPlantilla(
  sujetos: SujetoPlantilla[],
  columnas: ColumnaPlantilla[],
  objetivos: ObjetivoFila[],
): (string | number)[][] {
  const porClave = new Map<string, number>();
  for (const o of objetivos) {
    const ambito = ambitoDe(o);
    if (!ambito) continue;
    // La fuente entra en la clave: el objetivo del operador y el de la empresa
    // son de la misma tienda y la misma columna, y sin ella una fila se llevaría
    // la cifra de la otra.
    porClave.set(
      `${fuenteDe(o)}|${ambito}|${sujetoDeObjetivo(o)}|${columnaDeObjetivo(o)}`,
      o.cantidad,
    );
  }

  return sujetos.map((s) => {
    const fuente = s.fuente ?? "propio";
    return [
      textoAmbito(s.ambito, fuente),
      s.nombre,
      s.id,
      ...columnas.map((c) => porClave.get(`${fuente}|${s.ambito}|${s.id}|${c.id}`) ?? ""),
    ];
  });
}

/**
 * Cantidad escrita en una casilla de la hoja. Acepta lo que sale de Excel y lo
 * que escribe una persona: "30", "30 uds", "1.200" (miles a la española) y
 * "30,0". Un decimal de verdad se rechaza en vez de recortarlo: un objetivo de
 * 12,5 unidades es un dedazo, y guardarlo como 12 en silencio es peor.
 */
export function parsearCantidadPlantilla(
  bruto: string,
): { ok: true; cantidad: number } | { ok: false; error: string } {
  const s = (bruto ?? "")
    .replace(/\s/g, "")
    .replace(/uds?\.?$/i, "")
    .replace(/unidades$/i, "");
  if (!s) return { ok: false, error: "Casilla vacía." };

  // "1.200" es mil doscientos; "12.5" es un decimal. Se distinguen por la forma.
  const sinMiles = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  const n = Number(sinMiles.replace(",", "."));
  if (!Number.isFinite(n)) return { ok: false, error: `"${bruto.trim()}" no es un número.` };
  if (!Number.isInteger(n)) {
    return { ok: false, error: "El objetivo tiene que ser un número entero de unidades." };
  }
  return normalizarCantidadObjetivo(n);
}

/** Mes que trae escrito la hoja ("Mes | 2026-07"), si lo trae. */
export function leerMesPlantilla(matriz: string[][]): string | null {
  for (const fila of matriz.slice(0, 5)) {
    const celdas = fila ?? [];
    for (let i = 0; i < celdas.length; i++) {
      if (normalizar(celdas[i] ?? "") !== normalizar(ETIQUETA_MES)) continue;
      const valor = (celdas[i + 1] ?? "").trim();
      if (/^\d{4}-\d{2}$/.test(valor)) return valor;
    }
  }
  return null;
}

/** Índices de las columnas fijas dentro de la fila de encabezados. */
interface Cabecera {
  fila: number;
  ambito: number;
  sujeto: number;
  id: number;
}

/** Busca la fila de encabezados: la primera que tenga la columna de ámbito. */
function buscarCabecera(matriz: string[][]): Cabecera | null {
  for (let f = 0; f < Math.min(matriz.length, 10); f++) {
    const celdas = matriz[f] ?? [];
    const ambito = celdas.findIndex((c) => CABECERAS_AMBITO.includes(normalizar(c ?? "")));
    if (ambito === -1) continue;
    const sujeto = celdas.findIndex((c) => CABECERAS_SUJETO.includes(normalizar(c ?? "")));
    const id = celdas.findIndex((c) => CABECERAS_ID.includes(normalizar(c ?? "")));
    return { fila: f, ambito, sujeto, id };
  }
  return null;
}

/**
 * Lee la plantilla que devuelve el cliente y la convierte en objetivos a
 * aplicar. No lanza: lo que no cuadra se acumula en `ignoradas` para poder
 * enseñarlo, porque una hoja de 40 filas con una mal puesta tiene que importar
 * las otras 39.
 */
export function interpretarPlantillaObjetivos(
  matriz: string[][],
  ctx: {
    comerciales: { id: string; nombre: string }[];
    sedes: { id: string; nombre: string }[];
    /** Grupos de objetivos del cliente (TMT, televenta…). */
    grupos?: { id: string; nombre: string }[];
    articulos: ArticuloPlantilla[];
  },
): LecturaPlantilla {
  const ignoradas: { fila: number; motivo: string }[] = [];
  const columnasIgnoradas: { columna: string; motivo: string }[] = [];
  const mes = leerMesPlantilla(matriz);

  const cabecera = buscarCabecera(matriz);
  if (!cabecera) {
    return { cabeceraEncontrada: false, mes, cambios: [], ignoradas, columnasIgnoradas };
  }

  const paraObjetivos = ctx.articulos.filter((a) => cuentaParaObjetivos(a));
  // Un grupo es una subcategoría y nada más, así que su nombre lo identifica
  // sin ambigüedad posible (ticket 528694fa).
  const gruposProductos = subgruposDelCatalogo(paraObjetivos);
  const gruposPorNombre = new Map(gruposProductos.map((g) => [normalizar(g.subcategoria), g]));
  // Las columnas se casan por su título de hoy —el nombre, y detrás dónde está
  // si hay otro que se llama igual—, y además por el nombre pelado, que es lo
  // que traen las hojas de siempre. Un nombre pelado que en el catálogo ya
  // señala a dos artículos no se puede casar sin adivinar: se dice y se deja
  // fuera esa columna.
  const titulos = titulosDeArticulos(paraObjetivos);
  const porNombre = new Map<string, ArticuloPlantilla | null>();
  const anotar = (clave: string, a: ArticuloPlantilla) => {
    porNombre.set(clave, porNombre.has(clave) ? null : a);
  };
  for (const a of paraObjetivos) anotar(normalizar(titulos.get(a.id) ?? a.nombre), a);
  for (const a of paraObjetivos) {
    const soloNombre = normalizar(a.nombre);
    if (soloNombre === normalizar(titulos.get(a.id) ?? a.nombre)) continue;
    anotar(soloNombre, a);
  }
  const excluidos = new Set(
    ctx.articulos.filter((a) => !cuentaParaObjetivos(a)).map((a) => normalizar(a.nombre)),
  );

  // Columna de la hoja → columna de objetivos (id de artículo, "sub:<grupo>" o
  // unidades totales).
  const fijas = new Set([cabecera.ambito, cabecera.sujeto, cabecera.id].filter((i) => i >= 0));
  const columnas = new Map<number, ColumnaPlantilla>();
  (matriz[cabecera.fila] ?? []).forEach((bruto, i) => {
    if (fijas.has(i)) return;
    const titulo = (bruto ?? "").trim();
    if (!titulo) return;
    const norm = normalizar(titulo);

    if (TITULOS_TOTAL.includes(norm)) {
      columnas.set(i, { id: COLUMNA_TOTAL, titulo });
      return;
    }
    if (norm.startsWith(normalizar(PREFIJO_GRUPO_HOJA)) || norm.startsWith(PREFIJO_SUBGRUPO)) {
      const escrito = titulo.slice(titulo.indexOf(":") + 1);
      // Las hojas descargadas antes del cambio traen "Categoría → Subcategoría"
      // en la cabecera. Se sigue aceptando: vale lo que va tras la flecha.
      const conFlecha = escrito.lastIndexOf("→");
      const nombre = normalizar(conFlecha === -1 ? escrito : escrito.slice(conFlecha + 1));
      const real = gruposPorNombre.get(nombre);
      if (!real) {
        columnasIgnoradas.push({ columna: titulo, motivo: "Ese grupo no está en el catálogo." });
        return;
      }
      columnas.set(i, { id: columnaSubgrupo(real), titulo });
      return;
    }
    const articulo = porNombre.get(norm);
    if (articulo) {
      // Columna de producto de una hoja antigua: los objetivos van por grupo.
      const grupo = articulo.subcategoria;
      columnasIgnoradas.push({
        columna: titulo,
        motivo: grupo
          ? `Los objetivos se fijan por grupo: pon la cifra en la columna "${PREFIJO_GRUPO_HOJA}${grupo}".`
          : "Los objetivos se fijan por grupo de productos, no producto a producto.",
      });
      return;
    }
    columnasIgnoradas.push({
      columna: titulo,
      motivo:
        articulo === null
          ? "Hay dos artículos con ese nombre en el catálogo."
          : excluidos.has(norm)
            ? "Ese artículo está marcado como que no cuenta para los objetivos."
            : "No hay ningún artículo ni grupo con ese nombre.",
    });
  });

  const grupos = ctx.grupos ?? [];
  const porId = new Map<string, { ambito: AmbitoObjetivo; nombre: string }>([
    ...ctx.comerciales.map(
      (c) => [c.id, { ambito: "comercial" as AmbitoObjetivo, nombre: c.nombre }] as const,
    ),
    ...ctx.sedes.map((s) => [s.id, { ambito: "sede" as AmbitoObjetivo, nombre: s.nombre }] as const),
    ...grupos.map((g) => [g.id, { ambito: "grupo" as AmbitoObjetivo, nombre: g.nombre }] as const),
  ]);
  const comercialPorNombre = new Map(ctx.comerciales.map((c) => [normalizar(c.nombre), c]));
  const sedePorNombre = new Map(ctx.sedes.map((s) => [normalizar(s.nombre), s]));
  const grupoPorNombre = new Map(grupos.map((g) => [normalizar(g.nombre), g]));

  const cambios: CambioObjetivo[] = [];
  const vistos = new Set<string>();

  for (let f = cabecera.fila + 1; f < matriz.length; f++) {
    const celdas = matriz[f] ?? [];
    const numeroFila = f + 1; // fila de la hoja, 1-based
    if (!celdas.some((c) => (c ?? "").trim())) continue;

    const idHoja = cabecera.id >= 0 ? (celdas[cabecera.id] ?? "").trim() : "";
    const nombreHoja = cabecera.sujeto >= 0 ? (celdas[cabecera.sujeto] ?? "").trim() : "";
    const ambitoHoja = normalizar(celdas[cabecera.ambito] ?? "");

    // El id manda sobre el nombre: es lo que evita confundir a dos personas que
    // se llaman igual. El ámbito de la hoja solo se usa cuando hay que buscar
    // por nombre, porque el id ya dice si es una persona o una tienda.
    //
    // La FUENTE, en cambio, sale siempre del texto del ámbito: la misma tienda
    // baja en dos filas —su objetivo y el que le impone el operador— con el
    // mismo id, y lo único que las distingue es lo que diga esta columna.
    const fuenteFila: FuenteObjetivo = AMBITO_SEDE_TMT.includes(ambitoHoja) ? "tmt" : "propio";
    const conocido = idHoja ? porId.get(idHoja) : undefined;
    let ambito: AmbitoObjetivo;
    let sujetoId: string;
    let sujeto: string;

    if (conocido) {
      ambito = conocido.ambito;
      sujetoId = idHoja;
      sujeto = conocido.nombre;
    } else {
      if (idHoja) {
        ignoradas.push({
          fila: numeroFila,
          motivo: `El id "${idHoja}" ya no existe (¿empleado, sede o grupo dados de baja?).`,
        });
        continue;
      }
      if (AMBITO_COMERCIAL.includes(ambitoHoja)) ambito = "comercial";
      else if (AMBITO_SEDE.includes(ambitoHoja) || AMBITO_SEDE_TMT.includes(ambitoHoja))
        ambito = "sede";
      else if (AMBITO_GRUPO.includes(ambitoHoja)) ambito = "grupo";
      else {
        ignoradas.push({
          fila: numeroFila,
          motivo:
            'La columna Ámbito tiene que decir "Comercial", "Sede", "TMT punto de venta" o "Grupo".',
        });
        continue;
      }
      const donde =
        ambito === "comercial"
          ? { mapa: comercialPorNombre, plural: "los comerciales" }
          : ambito === "sede"
            ? { mapa: sedePorNombre, plural: "los puntos de venta" }
            : { mapa: grupoPorNombre, plural: "los grupos de objetivos" };
      const encontrado = donde.mapa.get(normalizar(nombreHoja));
      if (!encontrado) {
        ignoradas.push({
          fila: numeroFila,
          motivo: nombreHoja
            ? `No encontramos "${nombreHoja}" entre ${donde.plural}.`
            : "Falta el nombre del comercial, del punto de venta o del grupo.",
        });
        continue;
      }
      sujetoId = encontrado.id;
      sujeto = encontrado.nombre;
    }

    for (const [i, columna] of columnas) {
      const bruto = (celdas[i] ?? "").trim();
      // Casilla vacía: se deja como está. Para quitar un objetivo se escribe 0.
      if (!bruto) continue;

      // La fuente entra en la clave de duplicados: la misma tienda con el mismo
      // grupo puede salir dos veces, una por juego de objetivos, y eso no es un
      // duplicado.
      const clave = `${fuenteFila}|${ambito}|${sujetoId}|${columna.id}`;
      if (vistos.has(clave)) {
        ignoradas.push({
          fila: numeroFila,
          motivo: `"${sujeto}" sale más de una vez con objetivo en "${columna.titulo}": vale el primero.`,
        });
        continue;
      }

      const cantidad = parsearCantidadPlantilla(bruto);
      if (!cantidad.ok) {
        ignoradas.push({ fila: numeroFila, motivo: `"${columna.titulo}": ${cantidad.error}` });
        continue;
      }
      if (cambios.length >= PLANTILLA_MAX_CAMBIOS) {
        ignoradas.push({
          fila: numeroFila,
          motivo: `Pasa del máximo de ${PLANTILLA_MAX_CAMBIOS} objetivos por importación.`,
        });
        break;
      }

      vistos.add(clave);
      const grupo = subgrupoDeColumna(columna.id);
      cambios.push({
        ambito,
        sujetoId,
        articuloId: columna.id === COLUMNA_TOTAL || grupo ? null : columna.id,
        subcategoria: grupo?.subcategoria ?? null,
        // La categoría ya no identifica un grupo: el objetivo es de la
        // subcategoría entera (ticket 528694fa).
        categoria: null,
        fuente: fuenteFila,
        cantidad: cantidad.cantidad,
        sujeto,
        columna: columna.titulo,
      });
    }
  }

  return { cabeceraEncontrada: true, mes, cambios, ignoradas, columnasIgnoradas };
}
