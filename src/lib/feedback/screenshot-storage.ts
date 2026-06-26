// Almacenamiento de capturas del ticketing. Decisión de diseño (vs el bucket
// Supabase del original): se guardan como BYTES en BD (tabla FeedbackAdjunto).
// El "path" del paquete original pasa a ser el id del FeedbackAdjunto; las
// imágenes se sirven por un endpoint que devuelve los bytes.

import { prismaMaster } from "@/lib/prisma";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
] as const;

export type UploadResult = { path: string }; // path = id de FeedbackAdjunto

export class FeedbackScreenshotError extends Error {
  constructor(
    message: string,
    public readonly code: "too_large" | "mime_not_allowed" | "upload_failed",
  ) {
    super(message);
    this.name = "FeedbackScreenshotError";
  }
}

/** Sube una captura del cliente (multipart). Crea un FeedbackAdjunto huérfano
 *  (sin ticket/mensaje/job) que luego se enlaza al crear el ticket. */
export async function uploadScreenshot(file: {
  arrayBuffer(): Promise<ArrayBuffer>;
  type: string;
  size: number;
}): Promise<UploadResult> {
  if (file.size > MAX_BYTES) {
    throw new FeedbackScreenshotError(
      `El archivo supera el límite de 5MB (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
      "too_large",
    );
  }
  if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    throw new FeedbackScreenshotError(
      `Tipo de archivo no permitido: ${file.type}. Solo se aceptan imágenes.`,
      "mime_not_allowed",
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const adj = await prismaMaster.feedbackAdjunto.create({
    data: { data: new Uint8Array(buffer), contentType: file.type },
    select: { id: true },
  });
  return { path: adj.id };
}

/** Sube una captura ya en memoria (Buffer). La usa el runner para la captura
 *  del "después": manda los bytes y el app los persiste. */
export async function uploadScreenshotBuffer(
  buffer: Buffer,
  contentType: string,
): Promise<UploadResult> {
  if (buffer.byteLength > MAX_BYTES) {
    throw new FeedbackScreenshotError(
      `El archivo supera el límite de 5MB (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB)`,
      "too_large",
    );
  }
  if (!(ALLOWED_TYPES as readonly string[]).includes(contentType)) {
    throw new FeedbackScreenshotError(
      `Tipo de archivo no permitido: ${contentType}. Solo se aceptan imágenes.`,
      "mime_not_allowed",
    );
  }
  const adj = await prismaMaster.feedbackAdjunto.create({
    data: { data: new Uint8Array(buffer), contentType },
    select: { id: true },
  });
  return { path: adj.id };
}

/** Devuelve los bytes + content-type de un adjunto (para servirlo por endpoint). */
export async function getAdjuntoBytes(
  id: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  const adj = await prismaMaster.feedbackAdjunto.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });
  if (!adj) return null;
  return { data: Buffer.from(adj.data), contentType: adj.contentType };
}
