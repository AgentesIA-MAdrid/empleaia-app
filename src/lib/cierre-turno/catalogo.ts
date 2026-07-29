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

export interface FilaCatalogo {
  nombre: string;
  categoria: string | null;
  orden: number;
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
function detectarCabecera(primera: string[]): { esCabecera: boolean; colNombre: number; colCategoria: number } {
  let colNombre = 0;
  let colCategoria = -1;
  let esCabecera = false;

  primera.forEach((celda, i) => {
    const c = normalizar(celda ?? "");
    if (CABECERAS_NOMBRE.includes(c)) {
      colNombre = i;
      esCabecera = true;
    } else if (CABECERAS_CATEGORIA.includes(c)) {
      colCategoria = i;
      esCabecera = true;
    }
  });

  // Sin encabezado reconocible: primera columna el nombre y, si hay una
  // segunda con texto, se toma como categoría.
  if (!esCabecera && primera.length > 1 && (primera[1] ?? "").trim()) {
    colCategoria = 1;
  }
  return { esCabecera, colNombre, colCategoria };
}

/**
 * Convierte una matriz de celdas (ya leída del Excel o del CSV) en filas de
 * catálogo. Descarta vacías y duplicadas, respetando el orden de la hoja: es
 * el orden en el que el comercial verá la tabla al cerrar su turno.
 */
export function construirCatalogo(matriz: string[][]): ResultadoImportacion {
  const ignoradas: { fila: number; motivo: string }[] = [];
  if (matriz.length === 0) return { filas: [], ignoradas, conCabecera: false };

  const { esCabecera, colNombre, colCategoria } = detectarCabecera(matriz[0] ?? []);
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

    filas.push({ nombre, categoria, orden: filas.length });
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
