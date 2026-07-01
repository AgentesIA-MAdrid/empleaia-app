/**
 * Helpers puros para campos personalizados de la ficha del empleado.
 * Compartidos por las rutas de definición y de valores. Sin dependencias
 * de Prisma (se inyecta el cliente en las rutas).
 */

/** Tipos de campo soportados (determinan el input del formulario). */
export const TIPOS_CAMPO = ["texto", "numero", "fecha"] as const;
export type TipoCampo = (typeof TIPOS_CAMPO)[number];

/**
 * Genera una clave estable (slug) a partir de la etiqueta: minúsculas,
 * sin acentos, separadas por `_`. Devuelve "" si no queda nada usable
 * (el caller aplica un fallback).
 */
export function slugCampo(etiqueta: string): string {
  return etiqueta
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}
