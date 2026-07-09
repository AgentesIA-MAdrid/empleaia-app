/**
 * Genera y descarga (solo cliente) un certificado/acta probatorio de la firma
 * electrónica de un documento. Usa jsPDF con import dinámico para no cargar la
 * librería hasta que el usuario pulsa "Descargar certificado".
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

export async function descargarCertificadoFirma(d: CertificadoFirmaData): Promise<void> {
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

  doc.save(`certificado-firma-${slug(d.documentoNombre)}.pdf`);
}
