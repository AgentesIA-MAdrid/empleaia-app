/**
 * Re-hidratación de los claims volátiles de la sesión (`rol`, `tiendaId`).
 *
 * Problema: esos claims se escriben UNA sola vez, en `authorize` (login),
 * y el JWT es inmutable hasta que caduca (30 días) o el usuario cierra
 * sesión. Si después el Administrador cambia el rol de alguien —p. ej.
 * promociona a un empleado a Administrador desde /admin/empleados— su
 * sesión sigue llevando el rol viejo. Efecto visible:
 *
 *  - `src/proxy.ts` le redirige `/admin/*` → `/empleado` (rol ≠ OWNER).
 *  - Los endpoints que filtran por `session.user.rol` (`/api/ausencias`,
 *    `/api/fichajes`, `/api/empleados`…) le devuelven solo sus propios
 *    registros o los de su sede, no los de toda la empresa.
 *
 * Solución: en cada resolución de sesión (el callback `jwt` de
 * `auth.config.ts` corre en cada `auth()` y en el proxy) releer `rol` y
 * `tiendaId` del usuario en la BD del tenant y sobreescribir los claims.
 * Para no añadir una query por request se cachea en memoria de proceso
 * por (slug, userId) con TTL corto.
 *
 * Tolerante a fallos: si al token le faltan los claims de tenant, el
 * usuario ya no existe o la BD falla, se devuelve `null` y el llamante
 * conserva los claims que ya traía el JWT.
 *
 * Contexto de tenant: se reconstruye desde los claims del propio token
 * (`tenantSlug`/`tenantId`), igual que hace `lookupTenantsByEmail`. No
 * abre ninguna vía cross-tenant: se lee el usuario en el schema del
 * mismo tenant que firmó el token.
 */

import { prismaApp } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant/context";

export interface UserClaims {
  rol: string;
  tiendaId: string | null;
}

/** Ventana de cacheo. Un cambio de rol tarda como máximo esto en aplicarse. */
export const CLAIMS_TTL_MS = 30_000;

interface CacheEntry {
  claims: UserClaims | null;
  at: number;
}

// En `globalThis` como el store de rate-limit: el proxy y el código de
// la app se compilan en bundles distintos y el hot reload de dev
// reinstancia los módulos; así comparten una única cache por proceso.
type ClaimsCache = Map<string, CacheEntry>;
const g = globalThis as { _sessionClaimsCache?: ClaimsCache };
const cache: ClaimsCache = (g._sessionClaimsCache ??= new Map());

// Techo defensivo: una entrada por usuario activo es despreciable, pero
// no dejamos crecer el Map sin límite en procesos de vida larga.
const MAX_ENTRIES = 5_000;

/** Solo para tests. */
export function _resetSessionClaimsCache(): void {
  cache.clear();
}

async function loadFromDb(
  tenantId: string,
  slug: string,
  userId: string,
): Promise<UserClaims | null> {
  const user = await runWithTenant(
    { tenantId, slug, status: "active", features: new Map() },
    async () =>
      prismaApp.user.findUnique({
        where: { id: userId },
        select: { rol: true, tiendaId: true },
      }),
  );
  return user ? { rol: user.rol, tiendaId: user.tiendaId } : null;
}

/**
 * Devuelve `rol`/`tiendaId` actuales del usuario, o `null` si no se
 * pueden determinar (token sin tenant, usuario inexistente, BD caída).
 *
 * `load` es inyectable para test sin BD.
 */
export async function freshUserClaims(
  token: Record<string, unknown>,
  load: (
    tenantId: string,
    slug: string,
    userId: string,
  ) => Promise<UserClaims | null> = loadFromDb,
): Promise<UserClaims | null> {
  // `id` lo escribe el callback jwt en el login; `sub` es el fallback
  // estándar de NextAuth (mismo valor) por si el token es más antiguo.
  const userId =
    typeof token.id === "string"
      ? token.id
      : typeof token.sub === "string"
        ? token.sub
        : null;
  const slug = typeof token.tenantSlug === "string" ? token.tenantSlug : null;
  const tenantId = typeof token.tenantId === "string" ? token.tenantId : "";
  // Tokens antiguos (pre Fase 3) o de contextos sin tenant: no hay nada
  // que releer. Se conservan los claims del JWT.
  if (!userId || !slug) return null;

  const key = `${slug}:${userId}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CLAIMS_TTL_MS) return hit.claims;

  try {
    const claims = await load(tenantId, slug, userId);
    if (cache.size >= MAX_ENTRIES) {
      for (const [k, v] of cache) {
        if (now - v.at >= CLAIMS_TTL_MS) cache.delete(k);
      }
      if (cache.size >= MAX_ENTRIES) cache.clear();
    }
    cache.set(key, { claims, at: now });
    return claims;
  } catch {
    // BD caída / schema del tenant no disponible: no degradamos la
    // sesión, seguimos con los claims actuales. Tampoco cacheamos el
    // fallo para reintentar en el request siguiente.
    return null;
  }
}
