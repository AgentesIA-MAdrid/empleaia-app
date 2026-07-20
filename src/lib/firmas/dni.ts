/**
 * Validación de DNI/NIE español para la firma manuscrita de documentos.
 *
 * - DNI: 8 dígitos + letra de control.
 * - NIE: inicial X/Y/Z (→ 0/1/2) + 7 dígitos + letra de control.
 *
 * La letra de control es `LETRAS[numero % 23]`.
 */
const LETRAS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** Normaliza un DNI/NIE: sin espacios ni guiones, en mayúsculas. */
export function normalizarDni(valor: string): string {
  return valor.replace(/[\s-]/g, "").toUpperCase();
}

/** Comprueba que un DNI/NIE tiene formato y letra de control correctos. */
export function validarDni(valor: unknown): boolean {
  if (typeof valor !== "string") return false;
  const dni = normalizarDni(valor);
  const match = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(dni);
  if (!match) return false;
  const [, prefijo, digitos, letra] = match;

  // Longitud total: DNI = 8 dígitos; NIE = prefijo + 7 dígitos.
  if (prefijo && digitos.length !== 7) return false;
  if (!prefijo && digitos.length !== 8) return false;

  const prefijoNum = prefijo ? String("XYZ".indexOf(prefijo)) : "";
  const numero = Number.parseInt(prefijoNum + digitos, 10);
  return LETRAS[numero % 23] === letra;
}
