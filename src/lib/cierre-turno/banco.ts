/**
 * Importador de movimientos bancarios — lógica pura (entrega 4).
 *
 * El problema real: **cada banco exporta distinto**. Uno pone la fecha en la
 * columna A y el importe en la D; otro trae "Fecha valor" y "Fecha operación";
 * otro parte el importe en dos columnas (debe y haber). Adivinarlo funciona el
 * 80 % de las veces, y el 20 % restante son importes mal leídos en la
 * conciliación de la caja de un cliente. Así que el mapeo es **configuración del
 * tenant** (`ConfiguracionEmpresa.bancoMapeo`) y esto lo aplica.
 *
 * Lo que sí hacemos es proponer un mapeo mirando las cabeceras, para que el
 * cliente confirme en vez de rellenar un formulario a ciegas.
 *
 * Sin Prisma ni ficheros: el handler extrae las celdas (Excel o CSV, ya
 * resueltos en `catalogo-excel.ts` / `parsearCSV`) y aquí se decide qué fila
 * vale, con qué fecha y con qué importe.
 */

/** Cómo leer el extracto de un cliente. Índices de columna, base 0. */
export interface MapeoBanco {
  fecha: number;
  importe: number;
  concepto?: number | null;
  referencia?: number | null;
  /** Columna alternativa cuando el banco separa cargos y abonos. */
  importeHaber?: number | null;
  /**
   * Columnas que se SUMAN para formar el importe (ticket 4b8e1d05). El export
   * de facturación trae una columna por medio de pago —"Efectivo" y "Tarjeta"—
   * y lo facturado de esa línea es la suma: no son alternativas como el
   * debe/haber de un banco, son partes del mismo importe.
   */
  importeSuma?: number[] | null;
  /**
   * Columna con el punto de venta, cuando el fichero trae varias tiendas
   * mezcladas. El extracto del banco se sube por sede; el de facturación viene
   * entero y cada línea dice a qué tienda pertenece.
   */
  sede?: number | null;
  /**
   * Aceptar importes negativos. En un extracto bancario un cargo no pinta nada
   * en la conciliación de caja; en facturación, un abono SÍ —resta de lo
   * facturado ese día— y descartarlo dejaría el cuadre inflado.
   */
  admitirNegativos?: boolean;
  /** Orden de los componentes de la fecha cuando viene como texto. */
  formatoFecha?: "dmy" | "mdy" | "ymd";
  /** Si la primera fila del fichero es cabecera. */
  conCabecera?: boolean;
  /**
   * Signo de los cobros con tarjeta en el extracto. Normalmente los abonos son
   * positivos, pero hay exportaciones donde todo viene sin signo.
   */
  soloPositivos?: boolean;
}

export const MAPEO_BANCO_DEFECTO: MapeoBanco = {
  fecha: 0,
  importe: 1,
  concepto: 2,
  referencia: null,
  importeHaber: null,
  formatoFecha: "dmy",
  conCabecera: true,
  soloPositivos: false,
};

export interface MovimientoLeido {
  /** Fecha del movimiento, a medianoche UTC (como las DATE del módulo). */
  fecha: Date;
  importe: number;
  concepto: string | null;
  /** Referencia del extracto o, si no trae, una generada de forma determinista. */
  referencia: string;
  /** True si la referencia la hemos generado nosotros. */
  referenciaGenerada: boolean;
  /** El punto de venta tal cual lo trae el fichero, si lo trae. */
  sedeTexto?: string | null;
}

export interface ResultadoLecturaBanco {
  movimientos: MovimientoLeido[];
  ignoradas: { fila: number; motivo: string }[];
}

/** Quita tildes y pasa a minúsculas, para comparar cabeceras. */
function normalizar(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

const CAB_FECHA = ["fecha", "fecha operacion", "fecha de operacion", "fecha valor", "f. valor", "fecha contable", "fecha factura", "date"];
const CAB_IMPORTE = ["importe", "importe (eur)", "cantidad", "amount", "movimiento", "importe eur", "total"];
const CAB_HABER = ["haber", "abono", "abonos", "credito", "ingreso", "ingresos"];
const CAB_CONCEPTO = ["concepto", "descripcion", "detalle", "observaciones", "concepto ampliado", "description"];
const CAB_REFERENCIA = ["referencia", "ref", "n. movimiento", "num movimiento", "id", "numero de operacion", "factura", "n factura", "num factura"];
/** Columnas que son parte del importe y hay que sumar (ver `importeSuma`). */
const CAB_MEDIO_PAGO = ["efectivo", "tarjeta", "metalico", "contado", "financiado"];
/** Columnas que dicen a qué tienda pertenece la línea (ver `sede`). */
const CAB_SEDE = ["punto de venta", "pdv", "tienda", "sede", "centro", "establecimiento", "delegacion"];

/**
 * Propone un mapeo a partir de la primera fila. Es una sugerencia para que el
 * cliente la confirme, no una decisión: `reconocidas` dice qué ha encontrado por
 * su nombre y qué se está dando por supuesto.
 */
export function proponerMapeo(primeraFila: string[]): {
  mapeo: MapeoBanco;
  reconocidas: { fecha: boolean; importe: boolean; concepto: boolean; referencia: boolean };
} {
  const mapeo: MapeoBanco = { ...MAPEO_BANCO_DEFECTO, concepto: null };
  const reconocidas = { fecha: false, importe: false, concepto: false, referencia: false };
  const medios: number[] = [];

  primeraFila.forEach((celda, i) => {
    const c = normalizar(celda);
    if (CAB_MEDIO_PAGO.includes(c)) {
      // Una columna por medio de pago: el importe de la línea es la suma.
      medios.push(i);
    } else if (CAB_SEDE.includes(c)) {
      mapeo.sede = i;
    } else if (!reconocidas.fecha && CAB_FECHA.includes(c)) {
      mapeo.fecha = i;
      reconocidas.fecha = true;
    } else if (!reconocidas.importe && CAB_IMPORTE.includes(c)) {
      mapeo.importe = i;
      reconocidas.importe = true;
    } else if (CAB_HABER.includes(c)) {
      // Extracto con debe/haber: el haber es la columna de los abonos.
      if (reconocidas.importe) mapeo.importeHaber = i;
      else {
        mapeo.importe = i;
        reconocidas.importe = true;
      }
    } else if (!reconocidas.concepto && CAB_CONCEPTO.includes(c)) {
      mapeo.concepto = i;
      reconocidas.concepto = true;
    } else if (!reconocidas.referencia && CAB_REFERENCIA.includes(c)) {
      mapeo.referencia = i;
      reconocidas.referencia = true;
    }
  });

  if (medios.length > 0) {
    mapeo.importeSuma = medios;
    mapeo.importe = medios[0]!;
    reconocidas.importe = true;
    // Un fichero desglosado por medio de pago es de facturación, no un
    // extracto: ahí los abonos cuentan y restan.
    mapeo.admitirNegativos = true;
  }

  // Sin ninguna cabecera reconocida, la primera fila es un movimiento.
  mapeo.conCabecera =
    reconocidas.fecha ||
    reconocidas.importe ||
    reconocidas.concepto ||
    reconocidas.referencia ||
    mapeo.sede != null;
  return { mapeo, reconocidas };
}

/**
 * Fecha de una celda. Acepta lo que sale de un Excel español y lo que ya viene
 * como Date (exceljs devuelve Date en celdas con formato de fecha).
 *
 * Devuelve null si no hay fecha reconocible: es mejor dejar la fila fuera y
 * decirlo que colocar un movimiento en un día inventado.
 */
export function parsearFechaBanco(valor: unknown, formato: MapeoBanco["formatoFecha"] = "dmy"): Date | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return new Date(Date.UTC(valor.getUTCFullYear(), valor.getUTCMonth(), valor.getUTCDate()));
  }
  const s = String(valor ?? "").trim();
  if (!s) return null;

  // ISO directo (2026-07-30, o con hora detrás).
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const partes = s.match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!partes) return null;
  const a = Number(partes[1]);
  const b = Number(partes[2]);
  const c = Number(partes[3]);

  let dia: number;
  let mes: number;
  let anio: number;
  if (formato === "ymd") {
    anio = a;
    mes = b;
    dia = c;
  } else if (formato === "mdy") {
    mes = a;
    dia = b;
    anio = c;
  } else {
    dia = a;
    mes = b;
    anio = c;
  }
  // Año de dos cifras: 00-79 → 2000s, 80-99 → 1900s (extractos antiguos).
  if (anio < 100) anio += anio < 80 ? 2000 : 1900;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  const d = new Date(Date.UTC(anio, mes - 1, dia));
  // Rechaza 31 de febrero y compañía: Date lo "arregglaría" pasando de mes.
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d;
}

/**
 * Importe de una celda del extracto. Soporta "1.234,56", "1234.56", "1 234,56",
 * paréntesis para negativos —"(50,00)"— y el símbolo del euro.
 */
export function parsearImporteBanco(valor: unknown): number | null {
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : null;
  }
  let s = String(valor ?? "")
    .replace(/[€\s ]/g, "")
    .trim();
  if (!s) return null;

  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negativo = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  // Si hay coma, es el decimal y los puntos son miles. Si solo hay puntos y el
  // último grupo tiene 3 dígitos, son miles ("1.234" = 1234, no 1,234).
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g)?.length ?? 0) >= 1) {
    const trozos = s.split(".");
    const ultimo = trozos[trozos.length - 1];
    if (ultimo.length === 3) s = trozos.join("");
  }

  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  const abs = Math.round(n * 100) / 100;
  if (Math.abs(abs) > 10_000_000) return null;
  return negativo ? -abs : abs;
}

/**
 * Referencia determinista para una fila sin referencia propia.
 *
 * Hace de clave de idempotencia: si el cliente vuelve a subir el mismo extracto
 * (algo que pasa siempre), las filas ya importadas no se duplican. Es un hash
 * corto en base 36 de fecha + importe + concepto + sede; no necesita ser
 * criptográfico, solo estable.
 */
export function referenciaSintetica(args: {
  fecha: Date;
  importe: number;
  concepto: string | null;
  tiendaId: string | null;
}): string {
  const base = [
    args.fecha.toISOString().slice(0, 10),
    args.importe.toFixed(2),
    (args.concepto ?? "").slice(0, 60).toLowerCase().replace(/\s+/g, " ").trim(),
    args.tiendaId ?? "",
  ].join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c + i, 2246822519) >>> 0;
  }
  return `auto-${h1.toString(36)}${h2.toString(36)}`;
}

/** Tope de filas por importación: un extracto mensual no llega ni de lejos. */
export const BANCO_MAX_FILAS = 5000;

/**
 * Convierte la hoja del banco en movimientos, aplicando el mapeo del cliente.
 *
 * Criterio: solo se importan **abonos** (importe > 0). La conciliación compara
 * lo que el banco ha ingresado con lo que se cobró por datáfono; los cargos
 * (comisiones, recibos) no tienen nada que ver con la caja de la tienda y solo
 * meterían ruido. Los cargos se cuentan como ignorados, para que se vea.
 */
export function leerMovimientosBanco(
  matriz: unknown[][],
  mapeo: MapeoBanco,
  tiendaId: string | null,
): ResultadoLecturaBanco {
  const ignoradas: { fila: number; motivo: string }[] = [];
  const movimientos: MovimientoLeido[] = [];
  if (matriz.length === 0) return { movimientos, ignoradas };

  const cuerpo = mapeo.conCabecera === false ? matriz : matriz.slice(1);
  const desplazamiento = mapeo.conCabecera === false ? 1 : 2;
  const vistas = new Set<string>();

  cuerpo.forEach((celdas, i) => {
    const nFila = i + desplazamiento;
    if (movimientos.length >= BANCO_MAX_FILAS) {
      ignoradas.push({ fila: nFila, motivo: `Pasa del máximo de ${BANCO_MAX_FILAS} movimientos` });
      return;
    }
    // Fila vacía del final de la hoja: normal, no es un error.
    if (!celdas || celdas.every((c) => String(c ?? "").trim() === "")) return;

    const fecha = parsearFechaBanco(celdas[mapeo.fecha], mapeo.formatoFecha);
    if (!fecha) {
      ignoradas.push({ fila: nFila, motivo: "Sin fecha reconocible" });
      return;
    }

    let importe: number | null;
    if (mapeo.importeSuma && mapeo.importeSuma.length > 0) {
      // Varias columnas que son partes del mismo importe (efectivo + tarjeta).
      // Basta con que una traiga número: las demás vienen a 0 o vacías.
      let suma = 0;
      let alguna = false;
      for (const col of mapeo.importeSuma) {
        const parte = parsearImporteBanco(celdas[col]);
        if (parte !== null) {
          suma += parte;
          alguna = true;
        }
      }
      importe = alguna ? Math.round(suma * 100) / 100 : null;
    } else {
      importe = parsearImporteBanco(celdas[mapeo.importe]);
      // Extracto con debe/haber: si la columna principal viene vacía, se mira el
      // haber. Un abono está en una de las dos, nunca en las dos.
      if ((importe === null || importe === 0) && mapeo.importeHaber != null) {
        const haber = parsearImporteBanco(celdas[mapeo.importeHaber]);
        if (haber !== null && haber !== 0) importe = Math.abs(haber);
      }
    }
    if (importe === null) {
      ignoradas.push({ fila: nFila, motivo: "Sin importe reconocible" });
      return;
    }
    if (mapeo.soloPositivos) importe = Math.abs(importe);
    if (importe === 0) {
      // Una factura sin cobro (financiada, a cargo de otro) no aporta nada al
      // cuadre de caja, pero tampoco es un error del fichero.
      ignoradas.push({ fila: nFila, motivo: "Sin importe cobrado" });
      return;
    }
    if (importe < 0 && !mapeo.admitirNegativos) {
      ignoradas.push({ fila: nFila, motivo: "Es un cargo, no un ingreso" });
      return;
    }

    const concepto =
      mapeo.concepto != null ? String(celdas[mapeo.concepto] ?? "").trim().slice(0, 300) || null : null;
    const refPropia =
      mapeo.referencia != null ? String(celdas[mapeo.referencia] ?? "").trim().slice(0, 120) : "";
    const sedeTexto =
      mapeo.sede != null ? String(celdas[mapeo.sede] ?? "").trim().slice(0, 200) || null : null;
    const referencia =
      refPropia ||
      referenciaSintetica({ fecha, importe, concepto: concepto ?? sedeTexto, tiendaId });

    // Duplicados dentro del mismo fichero: dos filas idénticas sin referencia
    // propia colapsarían en la misma clave y la segunda se perdería al guardar.
    // Se marca aquí para poder decírselo a quien sube el extracto.
    if (vistas.has(referencia)) {
      ignoradas.push({ fila: nFila, motivo: "Repetida en el propio fichero" });
      return;
    }
    vistas.add(referencia);

    movimientos.push({
      fecha,
      importe,
      concepto,
      referencia,
      referenciaGenerada: !refPropia,
      sedeTexto,
    });
  });

  return { movimientos, ignoradas };
}

/** Valida un mapeo llegado del cliente (o guardado en la configuración). */
export function normalizarMapeo(valor: unknown): { ok: true; mapeo: MapeoBanco } | { ok: false; error: string } {
  if (!valor || typeof valor !== "object") return { ok: false, error: "Falta el mapeo de columnas." };
  const v = valor as Record<string, unknown>;

  const col = (x: unknown): number | null => {
    const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number.parseInt(x, 10) : Number.NaN;
    return Number.isInteger(n) && n >= 0 && n < 200 ? n : null;
  };

  const fecha = col(v.fecha);
  const importe = col(v.importe);
  if (fecha === null) return { ok: false, error: "Indica qué columna es la fecha." };
  if (importe === null) return { ok: false, error: "Indica qué columna es el importe." };

  const formato = v.formatoFecha;
  const formatoFecha: MapeoBanco["formatoFecha"] =
    formato === "mdy" || formato === "ymd" || formato === "dmy" ? formato : "dmy";

  return {
    ok: true,
    mapeo: {
      fecha,
      importe,
      concepto: v.concepto === null || v.concepto === undefined || v.concepto === "" ? null : col(v.concepto),
      referencia: v.referencia === null || v.referencia === undefined || v.referencia === "" ? null : col(v.referencia),
      importeHaber:
        v.importeHaber === null || v.importeHaber === undefined || v.importeHaber === ""
          ? null
          : col(v.importeHaber),
      importeSuma: Array.isArray(v.importeSuma)
        ? (v.importeSuma.map(col).filter((n): n is number => n !== null) ?? null)
        : null,
      sede: v.sede === null || v.sede === undefined || v.sede === "" ? null : col(v.sede),
      admitirNegativos: v.admitirNegativos === true,
      formatoFecha,
      conCabecera: v.conCabecera !== false,
      soloPositivos: v.soloPositivos === true,
    },
  };
}

/**
 * El código del punto de venta dentro del texto que trae el fichero de
 * facturación (ticket 4b8e1d05).
 *
 * Viene como `"MY128022 - NEKSUS MADRID CC PLENILUNIO"`: delante el código del
 * operador, detrás su nombre. Se casa por el CÓDIGO y no por el nombre, porque
 * los nombres no coinciden con los nuestros —su "NEKSUS MAJADAHONDA CC GRAN
 * PZA" es nuestra "NEKSUS CC GRAN PLAZA 2"— y adivinarlos acabaría atribuyendo
 * el dinero de una tienda a otra.
 */
export function codigoDeSede(texto: string | null | undefined): string | null {
  const s = String(texto ?? "").trim();
  if (!s) return null;
  // "CÓDIGO - Nombre": el código es lo de delante del primer guion suelto.
  const conGuion = s.match(/^\s*([A-Za-z0-9._/-]{2,20})\s+[-–]\s+/);
  if (conGuion) return conGuion[1]!.toUpperCase();
  // Sin guion, vale si la primera palabra parece un código (letras y dígitos).
  const primera = s.split(/\s+/)[0] ?? "";
  if (/^[A-Za-z]{1,4}\d{3,}$/.test(primera)) return primera.toUpperCase();
  return null;
}
