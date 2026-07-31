/**
 * Genera el .xlsx de la plantilla de objetivos de venta.
 *
 * Aparte de `objetivos-plantilla.ts` por el mismo motivo que `catalogo-excel.ts`
 * lo está de `catalogo.ts`: esto sí toca una dependencia pesada (exceljs), que
 * se carga con `import()` dinámico para no arrastrarla en cada bundle. La
 * lectura de la hoja que vuelve la hace `leerHojaExcel`, que ya existe.
 */

import {
  CABECERA_AMBITO,
  CABECERA_ID,
  CABECERA_SUJETO,
  ETIQUETA_MES,
  type ColumnaPlantilla,
} from "./objetivos-plantilla";

/** Cómo se rellena la hoja, en la segunda pestaña del libro. */
const INSTRUCCIONES: string[][] = [
  ["Cómo rellenar esta plantilla"],
  [],
  [
    "1.",
    "Escribe en cada casilla las unidades que esa persona (o ese punto de venta) tiene que vender en el mes.",
  ],
  [
    "2.",
    "Las casillas ya vienen con los objetivos que tienes fijados ahora mismo. Cambia solo lo que quieras cambiar.",
  ],
  ["3.", "Una casilla en blanco se deja como está: no borra el objetivo que hubiera."],
  ["4.", "Para quitar un objetivo, escribe 0."],
  [
    "5.",
    'No cambies las columnas "Ámbito", "Comercial o punto de venta" ni "Id": son las que dicen de quién es cada fila.',
  ],
  [],
  ["Qué es cada columna"],
  [
    "Unidades totales",
    "El objetivo de todo lo que vende, sin distinguir producto. Es el que ve el comercial en su cierre de turno.",
  ],
  [
    "Grupo: …",
    "El objetivo de una categoría entera del catálogo. Se cumple con lo vendido de cualquier producto de ese grupo.",
  ],
  ["El resto", "El objetivo de ese producto concreto del catálogo."],
  [],
  [
    "Ojo",
    "Los objetivos de los comerciales y los de los puntos de venta son independientes: el de una sede se compara con lo que vende la sede entera, no con la suma de los de su equipo.",
  ],
  [
    "",
    "Los artículos marcados como que no cuentan para los objetivos no tienen columna (Configuración → Catálogo de ventas).",
  ],
  ["", "Vuelve a subir este mismo archivo desde Objetivos de venta → Importar objetivos."],
];

export async function generarPlantillaObjetivos(args: {
  mes: string;
  columnas: ColumnaPlantilla[];
  filas: (string | number)[][];
}): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet("Objetivos");

  // El mes va escrito en la hoja: es lo que permite avisar al importar si la
  // plantilla es de otro mes distinto del que se está fijando.
  hoja.addRow([ETIQUETA_MES, args.mes]);
  hoja.getRow(1).font = { bold: true };
  hoja.addRow([]);

  const cabeceras = [
    CABECERA_AMBITO,
    CABECERA_SUJETO,
    CABECERA_ID,
    ...args.columnas.map((c) => c.titulo),
  ];
  const filaCabecera = hoja.addRow(cabeceras);
  filaCabecera.font = { bold: true };
  for (const fila of args.filas) hoja.addRow(fila);

  // Anchos a ojo: las dos primeras columnas llevan nombres y el resto cifras.
  hoja.getColumn(1).width = 12;
  hoja.getColumn(2).width = 30;
  hoja.getColumn(3).width = 28;
  for (let i = 4; i <= cabeceras.length; i++) {
    hoja.getColumn(i).width = Math.min(Math.max((cabeceras[i - 1] ?? "").length + 2, 12), 30);
  }
  // Con muchos productos la hoja se va a la derecha: sin fijar las columnas de
  // nombre no se sabe de quién es la casilla que se está rellenando.
  hoja.views = [{ state: "frozen", xSplit: 3, ySplit: 3 }];

  const ayuda = wb.addWorksheet("Instrucciones");
  for (const fila of INSTRUCCIONES) ayuda.addRow(fila);
  ayuda.getRow(1).font = { bold: true };
  ayuda.getColumn(1).width = 20;
  ayuda.getColumn(2).width = 110;

  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
