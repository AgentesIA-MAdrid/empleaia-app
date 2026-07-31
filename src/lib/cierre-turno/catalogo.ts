/**
 * Importación del catálogo de artículos y servicios (lógica pura).
 *
 * El cliente sube su tabla en Excel o CSV; aquí se convierte en filas listas
 * para el catálogo. Sin Prisma ni lectura de ficheros: el handler extrae las
 * celdas y esto decide qué vale y qué no, de modo que se puede testear con
 * tablas de mentira sin base de datos ni ficheros de ejemplo.
 *
 * Criterio: ser tolerante con la hoja que llegue. Estas tablas las mantiene
 * gente en Excel, con encabezados en cualquier idioma, columnas de sobra,
 * filas en blanco y espacios de más. Rechazar el fichero por eso sería
 * garantizar que nadie lo use.
 */

/** Nombres de columna que reconocemos, normalizados (sin tildes ni mayúsculas). */
const CABECERAS_NOMBRE = ["nombre", "articulo", "artículo", "servicio", "producto", "concepto", "descripcion", "descripción"];
const CABECERAS_CATEGORIA = ["categoria", "categoría", "familia", "grupo", "tipo", "seccion", "sección"];
const CABECERAS_SUBCATEGORIA = [
  "subcategoria",
  "subcategoría",
  "sub categoria",
  "sub categoría",
  "subfamilia",
  "sub familia",
  "subgrupo",
  "sub grupo",
  "subtipo",
  "sub tipo",
  "subseccion",
  "subsección",
];
const CABECERAS_PRECIO = ["precio", "pvp", "importe", "tarifa", "coste", "euros"];

export interface FilaCatalogo {
  nombre: string;
  categoria: string | null;
  /** Segundo nivel dentro de la categoría, si la hoja traía esa columna. */
  subcategoria: string | null;
  orden: number;
  /** Precio unitario, si la hoja traía una columna de precio. */
  precio: number | null;
}

export interface ResultadoImportacion {
  filas: FilaCatalogo[];
  /** Filas saltadas y por qué, para poder decírselo a quien sube el fichero. */
  ignoradas: { fila: number; motivo: string }[];
  /** Si la primera fila se ha tomado como encabezado. */
  conCabecera: boolean;
}

export const CATALOGO_MAX_FILAS = 500;
export const CATALOGO_NOMBRE_MAX = 120;

/** Quita tildes, espacios de sobra y pasa a minúsculas. */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * ¿La primera fila es un encabezado? Lo es si alguna celda coincide con un
 * nombre de columna conocido. Si el cliente no puso encabezados, la primera
 * fila es un artículo y no se pierde.
 */
function detectarCabecera(primera: string[]): {
  esCabecera: boolean;
  colNombre: number;
  colCategoria: number;
  colSubcategoria: number;
  colPrecio: number;
} {
  let colNombre = 0;
  let colCategoria = -1;
  let colSubcategoria = -1;
  let colPrecio = -1;
  let esCabecera = false;

  primera.forEach((celda, i) => {
    const c = normalizar(celda ?? "");
    if (CABECERAS_NOMBRE.includes(c)) {
      colNombre = i;
      esCabecera = true;
    } else if (CABECERAS_SUBCATEGORIA.includes(c)) {
      // Antes que la categoría: "subfamilia" no puede acabar leyéndose como
      // "familia" si algún día las listas se solapan.
      colSubcategoria = i;
      esCabecera = true;
    } else if (CABECERAS_CATEGORIA.includes(c)) {
      colCategoria = i;
      esCabecera = true;
    } else if (CABECERAS_PRECIO.includes(c)) {
      colPrecio = i;
      esCabecera = true;
    }
  });

  // Sin encabezado reconocible: primera columna el nombre y, si hay una
  // segunda con texto, se toma como categoría. Ni el precio ni la
  // subcategoría se adivinan por posición: una columna mal interpretada
  // (un precio colado como subcategoría, o al revés) es peor que no
  // importarla, y el cliente siempre puede poner el encabezado.
  if (!esCabecera && primera.length > 1 && (primera[1] ?? "").trim()) {
    colCategoria = 1;
  }
  return { esCabecera, colNombre, colCategoria, colSubcategoria, colPrecio };
}

/**
 * Clave con la que dos artículos se consideran el mismo: sin tildes, sin
 * mayúsculas y sin espacios de más. Se usa para no crear "Energía" y "energia"
 * como dos filas distintas, ni al importar ni al añadir a mano.
 */
export function claveArticulo(nombre: string): string {
  return normalizar(nombre.replace(/\s+/g, " "));
}

/**
 * Nombre de artículo tal y como se guarda cuando se escribe a mano (el
 * importador tiene su propio recorte por fila). Devuelve el motivo del rechazo
 * en vez de un booleano: es el texto que ve quien lo está escribiendo.
 */
export function normalizarNombreArticulo(
  bruto: unknown,
): { ok: true; nombre: string } | { ok: false; error: string } {
  const nombre = typeof bruto === "string" ? bruto.trim().replace(/\s+/g, " ") : "";
  if (nombre.length < 2) {
    return { ok: false, error: "Escribe el nombre del artículo (al menos 2 letras)." };
  }
  if (nombre.length > CATALOGO_NOMBRE_MAX) {
    return { ok: false, error: `El nombre pasa de ${CATALOGO_NOMBRE_MAX} caracteres.` };
  }
  return { ok: true, nombre };
}

/**
 * Categoría —o subcategoría, mismas reglas— escrita a mano: vacía es "sin
 * categoría", no una cadena vacía.
 */
export function normalizarCategoriaArticulo(bruto: unknown): string | null {
  const c = typeof bruto === "string" ? bruto.trim().replace(/\s+/g, " ") : "";
  return c ? c.slice(0, 80) : null;
}

/**
 * Sube (-1) o baja (+1) un artículo una posición dentro de la lista de ids.
 * Devuelve la lista nueva, o null si el movimiento no lleva a ninguna parte
 * (ya está en el extremo, o el id no está en la lista).
 */
export function moverEnOrden(ids: string[], id: string, direccion: -1 | 1): string[] | null {
  const desde = ids.indexOf(id);
  if (desde === -1) return null;
  const hasta = desde + direccion;
  if (hasta < 0 || hasta >= ids.length) return null;
  const nuevos = [...ids];
  nuevos[desde] = ids[hasta];
  nuevos[hasta] = ids[desde];
  return nuevos;
}

/** Lo mínimo que necesita una fila para poder agruparse por sus dos niveles. */
export interface ArticuloAgrupable {
  categoria: string | null;
  subcategoria: string | null;
}

export interface SubgrupoCatalogo<T> {
  /** null = artículos de la categoría que no están en ninguna subcategoría. */
  subcategoria: string | null;
  articulos: T[];
}

export interface GrupoCatalogo<T> {
  /** null = artículos sueltos, sin categoría. */
  categoria: string | null;
  subgrupos: SubgrupoCatalogo<T>[];
}

/** Clave con la que dos categorías (o subcategorías) son la misma. */
function claveGrupo(valor: string | null): string {
  return valor ? normalizar(valor.replace(/\s+/g, " ")) : "";
}

/**
 * Ordena el catálogo en sus dos niveles —categoría y, dentro, subcategoría—
 * respetando el orden que traen los artículos: el primero de cada grupo marca
 * dónde va el grupo, y dentro de él cada artículo mantiene su posición.
 *
 * Se agrupa por la categoría normalizada (sin tildes ni mayúsculas) pero se
 * muestra la primera forma escrita: "Telefonía" y "telefonia" son el mismo
 * grupo, que es lo que espera quien las tecleó en dos ratos distintos.
 *
 * No reordena por orden alfabético a propósito: el orden del catálogo lo
 * coloca administración con las flechas y es el que ve el comercial.
 */
export function agruparCatalogo<T extends ArticuloAgrupable>(articulos: T[]): GrupoCatalogo<T>[] {
  const grupos: GrupoCatalogo<T>[] = [];
  const porCategoria = new Map<string, GrupoCatalogo<T>>();
  // Un índice de subcategorías por categoría, y no uno global: la misma
  // subcategoría ("Móvil") puede colgar de dos categorías distintas y son
  // bloques distintos.
  const subgruposDe = new Map<GrupoCatalogo<T>, Map<string, SubgrupoCatalogo<T>>>();

  for (const articulo of articulos) {
    const claveCat = claveGrupo(articulo.categoria);
    let grupo = porCategoria.get(claveCat);
    if (!grupo) {
      grupo = { categoria: articulo.categoria?.trim() || null, subgrupos: [] };
      porCategoria.set(claveCat, grupo);
      subgruposDe.set(grupo, new Map());
      grupos.push(grupo);
    }
    const indiceSub = subgruposDe.get(grupo) as Map<string, SubgrupoCatalogo<T>>;

    const claveSub = claveGrupo(articulo.subcategoria);
    let subgrupo = indiceSub.get(claveSub);
    if (!subgrupo) {
      subgrupo = { subcategoria: articulo.subcategoria?.trim() || null, articulos: [] };
      indiceSub.set(claveSub, subgrupo);
      grupo.subgrupos.push(subgrupo);
    }
    subgrupo.articulos.push(articulo);
  }

  return grupos;
}

/** El catálogo agrupado, otra vez en una sola lista y en ese mismo orden. */
export function aplanarCatalogo<T extends ArticuloAgrupable>(grupos: GrupoCatalogo<T>[]): T[] {
  return grupos.flatMap((g) => g.subgrupos.flatMap((s) => s.articulos));
}

/**
 * Comprueba el orden que llega al endpoint de reordenar: tiene que ser el
 * catálogo entero, sin repetidos, sin artículos ajenos y sin dejarse ninguno.
 *
 * Se exige la lista completa (y no "mueve este a la posición 3") porque el
 * orden se reescribe de golpe: así dos artículos nunca acaban compartiendo
 * posición, que es lo que deja la tabla saltando de sitio entre recargas.
 *
 * `desfasado` se distingue de `malformado` porque no es lo mismo un cliente
 * que manda basura que dos pestañas abiertas: la segunda merece un "recarga la
 * página", no un error de datos.
 */
export function validarOrdenCatalogo(
  bruto: unknown,
  idsActuales: string[],
):
  | { ok: true; ids: string[] }
  | { ok: false; estado: "malformado" | "desfasado"; error: string } {
  if (!Array.isArray(bruto) || bruto.some((x) => typeof x !== "string")) {
    return { ok: false, estado: "malformado", error: "Datos no válidos" };
  }
  const ids = bruto as string[];
  if (new Set(ids).size !== ids.length) {
    return { ok: false, estado: "malformado", error: "Datos no válidos" };
  }
  const actuales = new Set(idsActuales);
  if (ids.length !== actuales.size || ids.some((id) => !actuales.has(id))) {
    return {
      ok: false,
      estado: "desfasado",
      error: "El catálogo ha cambiado mientras lo ordenabas. Recarga la página e inténtalo de nuevo.",
    };
  }
  return { ok: true, ids };
}

/**
 * Precio de una celda de Excel. Acepta "12,50", "12.50", "12,50 €" y miles
 * con punto ("1.234,50"): las hojas de precios españolas vienen así.
 * Devuelve null si no hay número aprovechable, y nunca un negativo.
 */
export function parsearPrecio(celda: string | undefined): number | null {
  const bruto = (celda ?? "").replace(/[€\s]/g, "").trim();
  if (!bruto) return null;

  // Con coma decimal, los puntos son separadores de miles.
  const normalizado = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
  const n = Number.parseFloat(normalizado);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Convierte una matriz de celdas (ya leída del Excel o del CSV) en filas de
 * catálogo. Descarta vacías y duplicadas, respetando el orden de la hoja: es
 * el orden en el que el comercial verá la tabla al cerrar su turno.
 */
export function construirCatalogo(matriz: string[][]): ResultadoImportacion {
  const ignoradas: { fila: number; motivo: string }[] = [];
  if (matriz.length === 0) return { filas: [], ignoradas, conCabecera: false };

  const { esCabecera, colNombre, colCategoria, colSubcategoria, colPrecio } = detectarCabecera(
    matriz[0] ?? [],
  );
  const cuerpo = esCabecera ? matriz.slice(1) : matriz;
  const desplazamiento = esCabecera ? 2 : 1; // nº de fila real en la hoja

  const vistos = new Set<string>();
  const filas: FilaCatalogo[] = [];

  cuerpo.forEach((celdas, i) => {
    const numeroFila = i + desplazamiento;
    if (filas.length >= CATALOGO_MAX_FILAS) {
      ignoradas.push({ fila: numeroFila, motivo: `Pasa del máximo de ${CATALOGO_MAX_FILAS} artículos` });
      return;
    }

    const nombre = (celdas[colNombre] ?? "").trim().replace(/\s+/g, " ");
    if (!nombre) {
      // Las filas en blanco del final de una hoja son lo normal, no un error
      // que haya que contar como problema.
      if (celdas.some((c) => (c ?? "").trim())) {
        ignoradas.push({ fila: numeroFila, motivo: "Sin nombre de artículo" });
      }
      return;
    }
    if (nombre.length > CATALOGO_NOMBRE_MAX) {
      ignoradas.push({ fila: numeroFila, motivo: `El nombre pasa de ${CATALOGO_NOMBRE_MAX} caracteres` });
      return;
    }

    const clave = normalizar(nombre);
    if (vistos.has(clave)) {
      ignoradas.push({ fila: numeroFila, motivo: `Repetido: "${nombre}"` });
      return;
    }
    vistos.add(clave);

    const categoria =
      colCategoria >= 0 ? ((celdas[colCategoria] ?? "").trim().replace(/\s+/g, " ") || null) : null;
    const subcategoria =
      colSubcategoria >= 0
        ? ((celdas[colSubcategoria] ?? "").trim().replace(/\s+/g, " ") || null)
        : null;
    const precio = colPrecio >= 0 ? parsearPrecio(celdas[colPrecio]) : null;

    filas.push({ nombre, categoria, subcategoria, orden: filas.length, precio });
  });

  return { filas, ignoradas, conCabecera: esCabecera };
}

/**
 * Parte un CSV en matriz. Soporta comas y punto y coma —Excel en España
 * exporta con punto y coma— y comillas dobles con comas dentro.
 */
export function parsearCSV(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const primeraLinea = limpio.split("\n")[0] ?? "";
  const separador = (primeraLinea.match(/;/g)?.length ?? 0) > (primeraLinea.match(/,/g)?.length ?? 0) ? ";" : ",";

  const filas: string[][] = [];
  let celda = "";
  let fila: string[] = [];
  let enComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (enComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        celda += c;
      }
      continue;
    }
    if (c === '"') {
      enComillas = true;
    } else if (c === separador) {
      fila.push(celda);
      celda = "";
    } else if (c === "\n") {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else {
      celda += c;
    }
  }
  if (celda || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas;
}
