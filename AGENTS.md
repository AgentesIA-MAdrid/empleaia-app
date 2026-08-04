<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Handoff entre sesiones

Antes de trabajar en una nueva sesión, lee `docs/HANDOFF.md`. Contiene
el estado del proyecto al cerrar la última conversación: features
recientes, decisiones operativas, contraseñas/IDs de prod no-secret y
pendientes abiertos. Mantenlo actualizado al cerrar cambios grandes.

# Desarrollo local multi-tenant (Fase 3)

Tras Fase 3 la app es multi-tenant: cada request necesita un `Host` que
resuelva a un tenant existente. Para desarrollo local:

```bash
# Una sola vez (o cuando se rompa la BD local):
NODE_ENV=development npm run dev:seed-tenant

# Después arranca dev y abre dev.localhost:
npm run dev
# http://dev.localhost:3000/login
#   email:    admin@dev.local
#   password: dev_password_2026
```

`dev:seed-tenant` crea el schema `tenant_dev` con la estructura del
producto, inserta un OWNER hardcodeado y registra `dev` en
`master.tenants`. Las credenciales **solo son válidas si
NODE_ENV=development** — el script aborta en producción.

Para `dev.localhost` no hace falta tocar `/etc/hosts` (macOS y Linux
modernos resuelven `*.localhost` a 127.0.0.1 por defecto). Si tu OS no
lo hace, añade `127.0.0.1 dev.localhost` a `/etc/hosts`.

# Schema multi-tenant — dos clientes Prisma

- `prisma/schema.prisma` → control plane (`master.*`).
  Cliente generado: `src/generated/prisma`.
  Lo usan: `prismaMaster`, `prismaRuntime`, `prismaQuotaWriter`.
- `prisma/schema-tenant.prisma` → producto (`tenant_<slug>.*`).
  Cliente generado: `src/generated/prisma-tenant`.
  Lo usa: `prismaApp` (multiplexado por tenant via Proxy).

Migraciones:
- `prisma/migrations/` (master): `npx prisma migrate dev/deploy`.
- `prisma/migrations-tenant/` (producto): aplicadas a cada
  `tenant_<slug>` con `npm run tenants:migrate -- <slug>` o
  `npm run tenants:migrate:all`.

Ningún archivo en `src/app/api/` debe importar `prisma` o
`prismaMaster`: la regla ESLint `fichaje/no-legacy-prisma` lo
bloquea. Usa `prismaApp` para datos del tenant.

# Convenciones de Fase 3 — handlers, prismaApp, authorize

## Todo handler nuevo en `src/app/api/**/route.ts` se envuelve con `withTenant`

Patrón obligatorio (ADR-002 §3.5 enmienda 6):

```ts
import { withTenant } from "@/lib/tenant/with-tenant";
import { prismaApp } from "@/lib/prisma";

export const GET = withTenant(async (req) => {
  const data = await prismaApp.user.findMany();
  return Response.json(data);
});

export const POST = withTenant(async (req) => {
  // …
});
```

Razón: Next 16 **no propaga `AsyncLocalStorage`** del `proxy.ts` al
handler de la ruta. Verificado empíricamente en cierre de Fase 3
(`proxy.ts: 4ms, application-code: 55ms` con error "No hay tenant").
Cada handler debe re-resolver el tenant explícitamente. `withTenant`
lo hace usando el cache del resolver (sin BD si el proxy ya cacheó).

`withTenant` también aplica:
- Status check (`active` continúa, `pending|provisioning` → 503,
  `suspended` → 402, `deleted` → 410).
- JWT cross-validation (slug del host vs `JWT.tenantSlug` → 401).

La regla ESLint `fichaje/no-legacy-prisma` bloquea `prisma`/`prismaMaster`
en `src/app/api/`. **Recomendación adicional Fase 4**: regla
`fichaje/route-must-use-withTenant` que verifique que cada handler
exporta vía `withTenant(...)`.

## Pages y layouts del subdominio tenant: `withTenantPage`

Pages (`page.tsx`) y layouts (`layout.tsx`) del subdominio tenant
(`<slug>.host`) que usen `prismaApp` o `currentTenant()` **DEBEN**
envolverse con `withTenantPage`:

```ts
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";

async function MyPage(props) {
  // usa prismaApp libremente — runWithTenant ya está activo.
  const data = await prismaApp.user.findMany();
  return <div>{...}</div>;
}

export default withTenantPage(MyPage);
```

Razón (Bug 4 de Fase 4 — variante de §11.3 en server components): el
HOF `withTenant` cubre solo route handlers (que exportan `GET`/`POST`).
Server components son funciones `async` sin entry point que el HOF de
handlers pueda envolver. `withTenantPage` es el equivalente:
internamente lee `headers()`, resuelve tenant del host y envuelve con
`runWithTenant`.

**El root layout (`src/app/layout.tsx`) NO se envuelve** — sirve todos
los hosts (apex, app, admin, tenant). Resuelve branding default
hardcoded sin tocar BD; el branding por tenant lo aplica el layout
del subdominio tenant (`(dashboard)/layout.tsx`) que SÍ está envuelto.

## Whitelist de endpoints exentos (no usan `withTenant`)

- `/api/auth/[...nextauth]` — NextAuth maneja su propio handler.
- `/api/setup`, `/api/setup/reset` — legacy mono-tenant, eliminados en Fase 4.
- `/api/webhooks/**` — no son del tenant (Stripe, etc.).
- `/api/admin/**` — Fase 7, panel super-admin con su propio contexto.

## `withTenant` NO autentica — el handler debe comprobar la sesión

Esto ya ha costado dos fugas en producción (auditoría 2026-08-04), así
que va con todas las letras: **`withTenant` resuelve el tenant a partir
del `Host` y solo cruza el JWT contra el slug _cuando el JWT existe_**:

```ts
// src/lib/tenant/with-tenant.ts
if (token && token.tenantSlug !== ctx.slug) return 401;
```

Una petición **sin cookie** tiene `token === null`, no entra en ese `if`
y llega al handler. El proxy tampoco cubre: `src/proxy.ts` hace
`if (isApiRoute) return NextResponse.next()` **antes** del redirect a
`/login`. Resultado real: `GET /api/organigrama` servía nombres,
correos corporativos, rol y jerarquía de toda la plantilla a cualquiera
que supiera el subdominio, y `/api/me/features` la plantilla activa, el
número de tiendas y el plan.

Todo handler nuevo empieza por identificar a quien llama:

```ts
export const GET = withTenant(async () => {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // …
});
```

Lo vigila la regla ESLint `fichaje/route-must-check-auth`. Acepta como
comprobación cualquier acreditación real —`auth()`, `getToken`,
`withApiV1` (API key), `requireServiceAuth`, un token HMAC de un solo
uso, un accessToken hasheado o un `process.env.*_SECRET` comparado a
mano—, no solo NextAuth. Si una ruta es pública **de verdad**, va a
`EXEMPT_PATHS` en `eslint.config.mjs` **con el motivo escrito al lado**;
si el motivo no cabe en una línea, probablemente sea un bug.

## Filtrar por sede: `null` no es "todas"

El otro rastrillo recurrente. Este filtro es una fuga esperando a pasar:

```ts
...(tiendaId ? { tiendaId } : {})   // ⚠️ con null DESAPARECE el filtro
```

Cuando `tiendaId` sale del **alcance del rol** (la sede de un
coordinador), un `null` no significa "enséñale todo": significa que no
tiene sede y no hay nada que enseñarle. Usa `sedesDelUsuario` +
`filtroSede` (`src/lib/cierre-turno/core.ts`), que distinguen `todas`,
`sedes` y `ninguna`. Además un coordinador lleva **varias** sedes desde
el ticket 73, así que el scope es una lista, no un id.

El ternario **sí** vale cuando el `tiendaId` es un filtro opcional que
un OWNER elige por querystring: ahí "sin filtro" es justo lo que pide.

## El cliente Prisma del producto es un Proxy

`prismaApp` (de `@/lib/prisma`) es un `Proxy` que en cada acceso de
propiedad llama `currentTenant()` y devuelve el `PrismaClient`
correspondiente al tenant activo (cacheado en
`globalThis._tenantClients: Map<slug, PrismaClient>`).

**Implicaciones**:

- `prismaApp.user.findMany()` solo funciona dentro de `runWithTenant`
  (que `withTenant` aplica automáticamente). Fuera de ese contexto
  lanza `Error: No hay tenant en el contexto`.
- **Nunca importar el cliente generado `@/generated/prisma-tenant`
  directamente** — siempre via `prismaApp`. Importar el cliente
  directo bypassa el multiplexado por tenant y abre fuga.
- Cada cliente Prisma se construye con `PrismaPgOptions.schema =
  "tenant_<slug>"`. El SQL generado cualifica con ese schema; no se
  usa `SET search_path`.

## `authorize` de NextAuth es caso especial

NextAuth invoca `authorize` en una continuación interna que NO
hereda el `runWithTenant` del proxy NI puede usar `withTenant`
(porque su firma es distinta: `(credentials, req)` no `(req)`).

Mitigación local en `src/lib/auth.ts`:

```ts
import { resolveTenant } from "@/lib/tenant/resolver";
import { runWithTenant } from "@/lib/tenant/context";

async authorize(credentials, req) {
  const host = req.headers?.get("host") ?? "";
  const resolved = await resolveTenant(host);
  if (resolved.kind !== "tenant" || resolved.ctx.status !== "active") return null;
  return await runWithTenant(resolved.ctx, async () => {
    // prisma.user.findUnique, bcrypt.compare, return { …, tenantId, tenantSlug }
  });
}
```

Si en Fase 4+ se añaden otros providers de NextAuth (OAuth, Email),
aplicar el mismo patrón en sus callbacks `authorize`/`signIn`.

## Server actions del subdominio `app` usan `prismaMaster`

Las server actions de páginas en el subdominio `app`
(`/registro`, `/registro/exito`, futuros checkout/landing) **NO
tienen tenant en contexto** (el proxy las trata como `kind=app`, sin
`runWithTenant`). Por tanto:

```ts
"use server";
import { prismaMaster } from "@/lib/prisma";

export async function registrarTenantAction(formData: FormData) {
  // Usar prismaMaster para INSERT en master.tenants.
  // NO usar prismaApp aquí — lanza "No hay tenant en el contexto".
  await prismaMaster.tenant.create({ data: { ... } });
}
```

Análogo al webhook `/api/webhooks/stripe` y a `/api/onboarding/status`:
todos en subdominio app, todos usan `prismaMaster`. Whitelist
explícita en `eslint.config.mjs` para `fichaje/no-legacy-prisma`.

## Discrepancia desarrollo vs producción (roles Postgres)

En desarrollo local usamos un único superuser (`fichaje_admin` en el
container `fichaje_postgres:5433`) para los 4 clientes Prisma. Los 4
roles separados (`master_role`, `app_role`, `tenant_runtime_role`,
`quota_writer_role`) sólo se crean en producción (Fase 8).

`tenants-provision.ts` y `dev-seed-tenant.ts` toleran que esos roles
no existan (try/catch en GRANTs) — alineado con esta decisión. No
intentes crear los 4 roles en local, no aporta seguridad y rompe la
provisión.

## Convención: NO fetch interno entre rutas Next del mismo proceso

PROHIBIDO hacer `fetch("http://...localhost:3000/api/...")` desde un
route handler para llamar a otro endpoint del mismo proceso.

Razón: en Node runtime, `dev.localhost`/`tenant.host` se resuelve
distinto que en el navegador (Node sigue DNS y `/etc/hosts`; no
trata `*.localhost` como loopback automático en todos los OS), y en
producción el contenedor puede no llegarse a sí mismo por nombre.
Resultado típico: `ECONNREFUSED` con stack `fetch failed` →
500 en runtime y bug invisible en tests con mocks.

Patrón correcto: extraer la lógica compartida a una función pura en
`src/lib/<dominio>/` que reciba el cliente Prisma como dependencia.
Ambos handlers la invocan directamente. Caso de referencia:
`src/lib/informes/queries.ts` (compartido por `/api/informes` y
`/api/informes/exportar`).

Test E2E recomendado para cualquier endpoint feature-gated: ver
`src/tests/integration/feature-guarded-endpoint.e2e.test.ts` y
`src/tests/integration/informes-export.e2e.test.ts` — invocan al
handler directamente con un `NextRequest`, sin levantar HTTP server.
