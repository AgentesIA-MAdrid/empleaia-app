/**
 * Listas de paths del proxy y matcher puro. Extraído de `proxy.ts`
 * para que sea testeable sin mockear NextAuth + NextRequest.
 *
 * Bug 5 Fase 4: la página /set-password no estaba en la whitelist y
 * el proxy redirigía al primer OWNER (sin password aún) a /login,
 * dejándolo en un loop sin salida.
 */

/**
 * Rutas auth públicas en el subdominio del tenant. Accesibles sin
 * sesión porque son parte del flow de auth (login, establecer
 * password, recuperación, etc).
 *
 * IMPORTANTE: añadir aquí cualquier página nueva en src/app/(auth)/
 * que deba ser accesible sin sesión.
 */
export const PUBLIC_AUTH_PATHS: readonly string[] = [
  "/login",
  "/set-password",
  "/recuperar-password",
] as const;

/**
 * Devuelve true si el pathname es una ruta auth pública. Match exacto
 * o prefijo con slash final (NO laxo: "/loginfake" o "/set-passwordX"
 * no matchean).
 */
export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
