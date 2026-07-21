/**
 * Genera y descarga (solo cliente) un certificado/acta probatorio de la firma
 * electrónica de un documento. Usa jsPDF con import dinámico para no cargar la
 * librería hasta que el usuario pulsa "Descargar".
 *
 * Los datos probatorios vienen de la Firma (GET /api/firmas): firmante, fecha,
 * hash SHA-256 del documento, IP y navegador con los que se firmó.
 *
 * `descargarFirmadoConCertificado` fusiona la copia sellada del documento con
 * el acta en un único PDF (pdf-lib, también dinámico), para que el usuario
 * descargue ambas cosas en un solo archivo en vez de por separado.
 */
import { downloadDoc } from "@/lib/documentos/url";

export interface CertificadoFirmaData {
  documentoNombre: string;
  firmanteNombre: string;
  firmadoEn: string; // ISO
  documentHash: string;
  ip?: string | null;
  userAgent?: string | null;
  empresaNombre?: string | null;
  firmanteDni?: string | null;
  /** Garabato manuscrito capturado al firmar (PNG data URL). */
  firmaImagen?: string | null;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "documento"
  );
}

/**
 * Construye el acta probatoria y la devuelve como instancia jsPDF (sin
 * guardarla en disco). Separado de la descarga para poder, o bien guardarla
 * suelta (`descargarCertificadoFirma`), o bien fusionarla con el documento
 * sellado en un único PDF (`descargarFirmadoConCertificado`).
 */
async function construirCertificado(d: CertificadoFirmaData) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const marginX = 20;
  let y = 24;

  // Cabecera
  doc.setFillColor(30, 27, 75); // indigo-950 (brand empleaIA)
  doc.rect(0, 0, W, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(30, 27, 75);
  doc.text("Certificado de firma electrónica", marginX, y);
  y += 6;
  doc.setDrawColor(226, 232, 240);
  doc.line(marginX, y, W - marginX, y);
  y += 10;

  if (d.empresaNombre) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(d.empresaNombre, marginX, y);
    y += 10;
  }

  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "normal");
  doc.text(
    "Este documento certifica que el firmante indicado abajo firmó electrónicamente",
    marginX,
    y,
  );
  y += 6;
  doc.text("el documento referenciado, con los siguientes datos probatorios:", marginX, y);
  y += 14;

  const fecha = (() => {
    try {
      return new Date(d.firmadoEn).toLocaleString("es-ES", {
        day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return d.firmadoEn;
    }
  })();

  const filas: [string, string][] = [
    ["Documento", d.documentoNombre],
    ["Firmante", d.firmanteNombre],
    ...(d.firmanteDni ? ([["DNI / NIE", d.firmanteDni]] as [string, string][]) : []),
    ["Fecha y hora de firma", fecha],
    ["Hash SHA-256 del documento", d.documentHash],
    ["Dirección IP", d.ip || "—"],
    ["Navegador", d.userAgent || "—"],
  ];

  doc.setFontSize(10);
  for (const [label, valor] of filas) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(71, 85, 105);
    doc.text(label, marginX, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    // Ajuste de línea para valores largos (hash, user agent).
    const wrapped = doc.splitTextToSize(valor, W - marginX * 2 - 55);
    doc.text(wrapped, marginX + 55, y);
    y += Math.max(7, wrapped.length * 5 + 2);
  }

  // Firma manuscrita (garabato) capturada al firmar.
  if (d.firmaImagen && /^data:image\/(png|jpe?g);base64,/i.test(d.firmaImagen)) {
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(71, 85, 105);
    doc.text("Firma manuscrita", marginX, y);
    y += 3;
    const fmt = d.firmaImagen.slice(11, 14).toUpperCase() === "JPE" ? "JPEG" : "PNG";
    try {
      doc.addImage(d.firmaImagen, fmt, marginX, y, 60, 24);
      y += 28;
    } catch {
      y += 2;
    }
  }

  y += 8;
  doc.setDrawColor(226, 232, 240);
  doc.line(marginX, y, W - marginX, y);
  y += 8;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const nota = doc.splitTextToSize(
    "El hash SHA-256 identifica de forma unívoca el contenido del documento firmado. " +
      "Cualquier modificación posterior del documento alteraría el hash, invalidando esta firma. " +
      "Certificado generado por empleaIA.",
    W - marginX * 2,
  );
  doc.text(nota, marginX, y);

  return doc;
}

/** Descarga solo el acta probatoria (usado cuando no hay copia sellada). */
export async function descargarCertificadoFirma(d: CertificadoFirmaData): Promise<void> {
  const doc = await construirCertificado(d);
  doc.save(`certificado-firma-${slug(d.documentoNombre)}.pdf`);
}

/** Convierte un data URL base64 en bytes (solo cliente, sin Buffer). */
function base64DataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const payload = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  return Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
}

/** Convierte bytes en un data URL de PDF (solo cliente, sin Buffer). */
function bytesToPdfDataUrl(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:application/pdf;base64,${btoa(binary)}`;
}

/**
 * Descarga en un ÚNICO PDF la copia sellada del documento seguida del acta
 * probatoria de la firma. Fusiona ambos con pdf-lib (import dinámico, ya es
 * dependencia del proyecto en `estampar.ts`): añade las páginas del acta al
 * final del documento firmado.
 *
 * Si el documento no tiene copia sellada (`documentoFirmadoUrl` nulo o no es un
 * PDF en data URL — p. ej. no era estampable), cae a descargar solo el acta,
 * preservando el comportamiento previo para esos casos.
 *
 * El `documentoFirmadoUrl` es un data URL local (decodificado en el navegador,
 * sin red ni ruta) — no aplica la regla de "no fetch interno entre rutas".
 */
export async function descargarFirmadoConCertificado(
  documentoFirmadoUrl: string | null | undefined,
  d: CertificadoFirmaData,
): Promise<void> {
  const acta = await construirCertificado(d);

  // Sin copia sellada estampable → solo el acta (comportamiento previo).
  if (!documentoFirmadoUrl || !/^data:application\/pdf[;,]/i.test(documentoFirmadoUrl)) {
    acta.save(`certificado-firma-${slug(d.documentoNombre)}.pdf`);
    return;
  }

  const { PDFDocument } = await import("pdf-lib");
  const combinado = await PDFDocument.load(base64DataUrlToBytes(documentoFirmadoUrl));
  const actaPdf = await PDFDocument.load(acta.output("arraybuffer"));
  const paginas = await combinado.copyPages(actaPdf, actaPdf.getPageIndices());
  paginas.forEach((p) => combinado.addPage(p));

  const out = await combinado.save();
  downloadDoc(bytesToPdfDataUrl(out), `${d.documentoNombre} (firmado).pdf`);
}
