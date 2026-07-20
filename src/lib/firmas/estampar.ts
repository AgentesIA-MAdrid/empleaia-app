/**
 * Estampado de la firma manuscrita en el margen izquierdo de cada hoja de un
 * documento (contratos laborales y anexos).
 *
 * Al firmar, el empleado teclea su nombre y DNI y dibuja un garabato. Esta
 * función coge el documento original (PDF o imagen, guardado como data URL),
 * y sella en el margen izquierdo de CADA página: el garabato + "Firmado por
 * <nombre> · DNI <dni> · <fecha>". Devuelve el documento sellado como data URL
 * de PDF, listo para guardar y descargar.
 *
 * Server-only: usa pdf-lib (JS puro, sin binarios nativos) y Buffer. No
 * importar desde componentes de cliente.
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFImage } from "pdf-lib";

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

interface EstamparParams {
  /** data URL del documento original (PDF o imagen rasterizada). */
  documentoUrl: string;
  /** data URL PNG/JPEG del garabato manuscrito. */
  garabatoUrl: string;
  nombre: string;
  dni: string;
  /** Momento de la firma. */
  fecha: Date;
}

// Geometría del sello (en puntos PDF).
const LEFT_PAD = 8; // separación del borde izquierdo
const MARGIN_W = 30; // grosor del sello en el margen
const BOTTOM_PAD = 22;
const GARABATO_MAX_LEN = 90; // largo máximo del garabato (a lo alto de la hoja)

/**
 * Estampa la firma en cada página del documento. Devuelve un data URL de PDF
 * con el documento sellado, o null si el documento no es estampable (p. ej.
 * una URL remota https, o un tipo no soportado).
 */
export async function estamparFirmaEnDocumento(
  params: EstamparParams,
): Promise<string | null> {
  const doc = parseDataUrl(params.documentoUrl);
  const garabato = parseDataUrl(params.garabatoUrl);
  if (!doc || !garabato) return null;

  let pdf: PDFDocument;

  if (doc.mime === "application/pdf") {
    try {
      pdf = await PDFDocument.load(doc.bytes);
    } catch {
      return null;
    }
  } else if (/^image\/(png|jpe?g)$/.test(doc.mime)) {
    // Documento escaneado como imagen: lo montamos en una hoja A4 dejando un
    // margen izquierdo limpio para el sello.
    pdf = await PDFDocument.create();
    const img =
      doc.mime === "image/png"
        ? await pdf.embedPng(doc.bytes)
        : await pdf.embedJpg(doc.bytes);
    const page = pdf.addPage([595.28, 841.89]); // A4 en puntos
    const areaX = MARGIN_W + LEFT_PAD * 2;
    const areaW = page.getWidth() - areaX - 20;
    const areaH = page.getHeight() - 40;
    const scale = Math.min(areaW / img.width, areaH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, {
      x: areaX + (areaW - w) / 2,
      y: (page.getHeight() - h) / 2,
      width: w,
      height: h,
    });
  } else {
    return null;
  }

  let sello: PDFImage;
  try {
    sello =
      garabato.mime === "image/png"
        ? await pdf.embedPng(garabato.bytes)
        : await pdf.embedJpg(garabato.bytes);
  } catch {
    return null;
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fecha = params.fecha.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const texto = `Firmado por ${params.nombre} · DNI ${params.dni} · ${fecha}`;

  // El garabato se dibuja rotado 90°: su lado largo queda a lo alto de la hoja.
  const aspecto = sello.width / sello.height || 1;
  const gAlto = Math.min(GARABATO_MAX_LEN, MARGIN_W * aspecto);
  const gAncho = Math.min(MARGIN_W, gAlto / aspecto);

  for (const page of pdf.getPages()) {
    // Garabato rotado 90°: al girar sobre (x,y), ocupa [x-gAncho, x] en
    // horizontal y [y, y+gAlto] en vertical.
    page.drawImage(sello, {
      x: LEFT_PAD + gAncho,
      y: BOTTOM_PAD,
      width: gAlto,
      height: gAncho,
      rotate: degrees(90),
    });
    // Texto vertical (rota 90°) subiendo por el margen, encima del garabato.
    page.drawText(texto, {
      x: LEFT_PAD + MARGIN_W / 2,
      y: BOTTOM_PAD + gAlto + 8,
      size: 7,
      font,
      color: rgb(0.29, 0.33, 0.41),
      rotate: degrees(90),
    });
  }

  const out = await pdf.save();
  return `data:application/pdf;base64,${Buffer.from(out).toString("base64")}`;
}
