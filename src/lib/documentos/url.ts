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
