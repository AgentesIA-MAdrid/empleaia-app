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
const CABECERAS_PRECIO = ["precio", "pvp", "importe", "tarifa", "coste", "euros"];

export interface FilaCatalogo {
  nombre: string;
  categoria: string | null;
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
  colPrecio: number;
} {
  let colNombre = 0;
  let colCategoria = -1;
  let colPrecio = -1;
  let esCabecera = false;

  primera.forEach((celda, i) => {
    const c = normalizar(celda ?? "");
    if (CABECERAS_NOMBRE.includes(c)) {
      colNombre = i;
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
  // segunda con texto, se toma como categoría. El precio NO se adivina por
  // posición: cobrar por una columna mal interpretada sería peor que no
  // importarla, y el cliente siempre puede poner "Precio" en la cabecera.
  if (!esCabecera && primera.length > 1 && (primera[1] ?? "").trim()) {
    colCategoria = 1;
  }
  return { esCabecera, colNombre, colCategoria, colPrecio };
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

/** Categoría escrita a mano: vacía es "sin categoría", no una cadena vacía. */
export function normalizarCategoriaArticulo(bruto: unknown): string | null {
  const c = typeof bruto === "string" ? bruto.trim().replace(/\s+/g, " ") : "";
  return c ? c.slice(0, 80) : null;
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

  const { esCabecera, colNombre, colCategoria, colPrecio } = detectarCabecera(matriz[0] ?? []);
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
    const precio = colPrecio >= 0 ? parsearPrecio(celdas[colPrecio]) : null;

    filas.push({ nombre, categoria, orden: filas.length, precio });
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
