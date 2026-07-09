/**
 * Validación del esquema de la `url` de un Documento. La url se guarda en BD y
 * se pinta en un `<a href>`, y ahora también la suben los empleados → hay que
 * blindar contra XSS almacenado (javascript:, data:text/html, data:image/svg+xml
 * —el SVG puede llevar scripts—, etc.).
 *
 * Permitido: https://, ruta same-origin (/algo, no //), PDF e imágenes rasterizadas
 * como data URL. Todo lo demás se rechaza.
 */
const SAFE_DOC_URL =
  /^(https:\/\/|\/(?!\/)|data:application\/pdf[;,]|data:image\/(png|jpe?g|gif|webp)[;,])/i;

export function isSafeDocUrl(url: unknown): url is string {
  return typeof url === "string" && url.length > 0 && SAFE_DOC_URL.test(url);
}

/** href seguro para render: la url si es válida, o "#" si no. */
export function safeDocHref(url: unknown): string {
  return isSafeDocUrl(url) ? url : "#";
}

/**
 * Abre un documento en una pestaña nueva de forma fiable (solo cliente).
 *
 * Los navegadores modernos BLOQUEAN la navegación top-level a `data:` URLs
 * (p. ej. `data:application/pdf;base64,…`): un `<a href={dataUrl}
 * target="_blank">` abre una pestaña en blanco. Para esas URLs convertimos el
 * data URL a un Blob y abrimos su `blob:` object URL (mismo origen, permitido).
 * Las https y las rutas same-origin se abren tal cual.
 *
 * Debe invocarse desde un gesto del usuario (onClick); la decodificación es
 * síncrona para no perder el gesto y evitar el bloqueo de pop-ups.
 */
export function openDocInNewTab(url: unknown): void {
  if (!isSafeDocUrl(url)) return;
  let href = url;
  let objectUrl: string | null = null;
  if (url.startsWith("data:")) {
    const blob = dataUrlToBlob(url);
    if (!blob) return;
    objectUrl = URL.createObjectURL(blob);
    href = objectUrl;
  }
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Damos tiempo a la nueva pestaña a cargar el blob antes de revocarlo.
  if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl!), 60_000);
}

/** Convierte un data URL (base64 o percent-encoded) en un Blob, o null si falla. */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const header = dataUrl.slice(5, comma); // sin el prefijo "data:"
  const mime = header.split(";")[0] || "application/octet-stream";
  const payload = dataUrl.slice(comma + 1);
  try {
    const bytes = /;base64/i.test(header)
      ? Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload));
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}
