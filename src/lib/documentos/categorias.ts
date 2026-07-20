/**
 * Categorías (carpetas / `TipoDocumento`) con tratamiento especial.
 *
 * `CATEGORIA_CONTRATOS_SLUG` es el slug de la carpeta seeded "Contratos
 * laborales y anexos" (migración `20260720120000_firma_garabato_contratos`).
 * Todo documento que se suba a esta carpeta dirigido a un empleado requiere
 * firma obligatoria: al crearlo se genera automáticamente una `SolicitudFirma`.
 *
 * Módulo puro (sin dependencias de servidor): se usa tanto en el backend
 * (`/api/documentos`) como en la UI para marcar la firma como obligatoria.
 */
export const CATEGORIA_CONTRATOS_SLUG = "contratos_laborales_y_anexos";

/** ¿La carpeta con este slug exige firma obligatoria del empleado? */
export function esCarpetaFirmaObligatoria(slug: string | null | undefined): boolean {
  return slug === CATEGORIA_CONTRATOS_SLUG;
}
