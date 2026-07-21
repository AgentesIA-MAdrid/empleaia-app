/**
 * Estampado de los datos que rellena el empleado en las posiciones marcadas de
 * un documento de plantilla.
 *
 * El OWNER/MANAGER marca en el editor de plantillas DÓNDE va cada campo
 * (`CampoPlantilla.posicion`, coordenadas normalizadas 0–1 con origen arriba a
 * la izquierda). Cuando el empleado rellena sus respuestas, esta función coge el
 * documento original (PDF o imagen, guardado como data URL) y escribe cada
 * respuesta en su sitio, devolviendo el documento resultante como data URL de
 * PDF, listo para guardar y descargar.
 *
 * Server-only: usa pdf-lib (JS puro, sin binarios nativos) y Buffer, igual que
 * `estampar.ts`. No importar desde componentes de cliente.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { normalizarCampos, type CampoPlantilla } from "@/lib/documentos/campos";

interface DataUrlParts {
  mime: string;
  bytes: Uint8Array;
}

/** Descompone un data URL en su MIME y bytes, o null si no es base64 válido. */
function parseDataUrl(url: string): DataUrlParts | null {
  if (!url.startsWith("data:")) return null;
  const comma = url.indexOf(",");
  if (comma === -1) return null;
  const header = url.slice(5, comma);
  const mime = (header.split(";")[0] || "").toLowerCase();
  if (!/;base64/i.test(header)) return null;
  try {
    const bytes = Uint8Array.from(Buffer.from(url.slice(comma + 1), "base64"));
    return { mime, bytes };
  } catch {
    return null;
  }
}

interface RellenarParams {
  /** data URL del documento original (PDF o imagen rasterizada). */
  documentoUrl: string;
  /** Definición de campos (con o sin posición). */
  campos: unknown;
  /** Respuestas del empleado, alineadas por índice con `campos`. */
  respuestas: string[];
}

const FONT_SIZE = 10;

/**
 * Escribe las respuestas del empleado en las posiciones marcadas y devuelve el
 * documento resultante como data URL de PDF, o null si el documento no es
 * estampable (URL remota, tipo no soportado) o no hay ningún campo colocado con
 * respuesta.
 */
export async function rellenarDocumentoConRespuestas(
  params: RellenarParams,
): Promise<string | null> {
  const campos = normalizarCampos(params.campos);
  // Solo tiene sentido generar el documento si hay campos colocados con dato.
  const aEstampar = campos
    .map((campo, i) => ({ campo, valor: (params.respuestas[i] ?? "").trim() }))
    .filter((c): c is { campo: CampoPlantilla & { posicion: NonNullable<CampoPlantilla["posicion"]> }; valor: string } =>
      Boolean(c.campo.posicion) && c.valor !== "",
    );
  if (aEstampar.length === 0) return null;

  const doc = parseDataUrl(params.documentoUrl);
  if (!doc) return null;

  let pdf: PDFDocument;

  if (doc.mime === "application/pdf") {
    try {
      pdf = await PDFDocument.load(doc.bytes);
    } catch {
      return null;
    }
  } else if (/^image\/(png|jpe?g)$/.test(doc.mime)) {
    // Documento escaneado como imagen: lo montamos en una hoja del tamaño exacto
    // de la imagen para que las coordenadas normalizadas del editor (que se
    // marcaron sobre esa imagen) coincidan al estampar. Todos los campos caen en
    // la única página (page 0).
    try {
      pdf = await PDFDocument.create();
      const img =
        doc.mime === "image/png"
          ? await pdf.embedPng(doc.bytes)
          : await pdf.embedJpg(doc.bytes);
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } catch {
      return null;
    }
  } else {
    return null;
  }

  let font;
  try {
    font = await pdf.embedFont(StandardFonts.Helvetica);
  } catch {
    return null;
  }

  const pages = pdf.getPages();
  for (const { campo, valor } of aEstampar) {
    const page = pages[Math.min(campo.posicion.page, pages.length - 1)];
    if (!page) continue;
    const { width, height } = page.getSize();
    // El editor usa origen arriba-izquierda; pdf-lib usa abajo-izquierda. La
    // baseline del texto se sitúa justo debajo del punto marcado.
    const x = campo.posicion.x * width;
    const y = height - campo.posicion.y * height - FONT_SIZE;
    page.drawText(valor.slice(0, 200), {
      x,
      y,
      size: FONT_SIZE,
      font,
      color: rgb(0.06, 0.09, 0.16),
    });
  }

  const out = await pdf.save();
  return `data:application/pdf;base64,${Buffer.from(out).toString("base64")}`;
}
