/**
 * Fuente única de verdad de los datos obligatorios de la ficha de
 * empleado en el primer acceso (onboarding bloqueante).
 *
 * Decisión de producto (2026-06-16): obligatorio = bloque
 * personal + dirección + contacto. Afiliación, retenciones y datos
 * bancarios son opcionales (el empleado los completa cuando quiera en
 * "Mi perfil"). El OWNER queda exento del flujo (ver
 * `src/app/(dashboard)/layout.tsx`).
 *
 * Lo usan el endpoint `PUT /api/empleados/[id]` (para recalcular
 * `perfilCompletado`) y la página `/completar-perfil`. Cambiar la lista
 * AQUÍ ajusta ambos a la vez.
 */

/** Campos obligatorios para considerar el perfil completo. */
export const CAMPOS_OBLIGATORIOS = [
  // Información personal
  "tipoIdentificacion",
  "dni",
  "nacionalidad",
  "estadoCivil",
  "genero",
  "fechaNacimiento",
  // Dirección
  "domicilio",
  "codigoPostal",
  "localidad",
  "provincia",
  "pais",
  // Contacto
  "telefono",
  "emailPersonal",
] as const;

export type CampoObligatorio = (typeof CAMPOS_OBLIGATORIOS)[number];

/** Un valor cuenta como "relleno" si no es null/undefined ni cadena vacía. */
function tieneValor(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

/**
 * ¿El empleado tiene todos los campos obligatorios rellenos?
 * Acepta cualquier objeto con (parte de) los campos del User.
 */
export function esPerfilCompleto(
  u: Partial<Record<CampoObligatorio, unknown>> | null | undefined,
): boolean {
  if (!u) return false;
  return CAMPOS_OBLIGATORIOS.every((campo) => tieneValor(u[campo]));
}

/** Devuelve la lista de campos obligatorios que faltan por rellenar. */
export function camposPerfilFaltantes(
  u: Partial<Record<CampoObligatorio, unknown>> | null | undefined,
): CampoObligatorio[] {
  if (!u) return [...CAMPOS_OBLIGATORIOS];
  return CAMPOS_OBLIGATORIOS.filter((campo) => !tieneValor(u[campo]));
}
