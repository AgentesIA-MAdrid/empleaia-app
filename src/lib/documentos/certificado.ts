/**
 * Genera y descarga (solo cliente) la copia sellada del documento firmado
 * seguida, en el MISMO PDF, del certificado/acta probatorio de la firma. Usa
 * jsPDF (certificado) y pdf-lib (fusión), ambos con import dinámico para no
 * cargar las librerías hasta que el usuario pulsa "Descargar".
 *
 * Los datos probatorios vienen de la Firma (GET /api/firmas): firmante, fecha,
 * hash SHA-256 del documento, IP y navegador con los que se firmó.
 */

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

/** Construye el PDF del certificado con jsPDF y lo devuelve (sin descargarlo). */
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

/** Dispara la descarga de un PDF (bytes) en el navegador. */
function descargarPdf(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Descarga en un ÚNICO PDF la copia sellada del documento firmado seguida del
 * certificado/acta probatorio de la firma (páginas del documento primero, el
 * acta al final). Si el documento no tiene copia sellada —p. ej. no era
 * estampable— se descarga solo el certificado.
 */
export async function descargarFirmadoConCertificado(
  documentoFirmadoUrl: string | null | undefined,
  d: CertificadoFirmaData,
): Promise<void> {
  const cert = await construirCertificado(d);
  const certBytes = new Uint8Array(cert.output("arraybuffer") as ArrayBuffer);

  // Sin copia sellada del documento: descarga solo el certificado.
  if (!documentoFirmadoUrl || !/^data:application\/pdf[;,]/i.test(documentoFirmadoUrl)) {
    descargarPdf(certBytes, `certificado-firma-${slug(d.documentoNombre)}.pdf`);
    return;
  }

  // Fusiona documento firmado + certificado en un solo PDF con pdf-lib.
  const { PDFDocument } = await import("pdf-lib");
  const firmadoBytes = new Uint8Array(
    await (await fetch(documentoFirmadoUrl)).arrayBuffer(),
  );
  const merged = await PDFDocument.load(firmadoBytes);
  const certPdf = await PDFDocument.load(certBytes);
  const paginas = await merged.copyPages(certPdf, certPdf.getPageIndices());
  for (const p of paginas) merged.addPage(p);
  const out = await merged.save();

  descargarPdf(out, `${slug(d.documentoNombre)}-firmado.pdf`);
}
