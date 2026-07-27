import type { NextAuthConfig } from "next-auth";
import { freshUserClaims } from "@/lib/auth/session-claims";

// NEXTAUTH_URL hace que NextAuth construya URLs absolutas a ese host
// para errores y callbacks. Como en producción NEXTAUTH_URL=app.empleaia.es
// y los tenants viven en <slug>.empleaia.es, eso provoca rebotes
// cross-subdomain (incluido el bucle de login post-CSRF). Con
// `trustHost: true` y sin esta env var, NextAuth deriva las URLs del
// host del request — comportamiento correcto multi-tenant.
//
// Lo eliminamos en runtime para no depender de cambios en Dokploy.
delete process.env.NEXTAUTH_URL;
delete process.env.AUTH_URL;

export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.rol = (user as any).rol;
        token.tiendaId = (user as any).tiendaId;
        token.nombre = (user as any).nombre;
        token.apellidos = (user as any).apellidos;
        // Fase 3 (ADR-002 §2.5): el JWT lleva tenantId+tenantSlug del
        // tenant donde el usuario hizo login. El proxy (commit 9)
        // compara esto con el slug del host y devuelve 401 si difieren.
        token.tenantId = (user as any).tenantId;
        token.tenantSlug = (user as any).tenantSlug;
        return token;
      }

      // Sin `user` = request posterior al login (NextAuth invoca este
      // callback en cada resolución de sesión). `rol`/`tiendaId` son
      // volátiles: el Administrador puede cambiarlos en cualquier
      // momento y el JWT no se re-emite hasta caducar. Los releemos de
      // BD (cacheado, ver session-claims.ts) para que un cambio de rol
      // —p. ej. promoción a Administrador— surta efecto sin obligar a
      // cerrar sesión y volver a entrar.
      const fresh = await freshUserClaims(token);
      if (fresh) {
        token.rol = fresh.rol;
        token.tiendaId = fresh.tiendaId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        (session.user as any).rol = token.rol;
        (session.user as any).tiendaId = token.tiendaId;
        (session.user as any).nombre = token.nombre;
        (session.user as any).apellidos = token.apellidos;
        (session.user as any).tenantId = token.tenantId;
        (session.user as any).tenantSlug = token.tenantSlug;
      }
      return session;
    },
  },
  providers: [],
};
