import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Plugin local con reglas custom — Fase 3 + Fase 5.
 *
 * Fase 3 commit 18:
 *  - `no-legacy-prisma`: prohíbe importar `prisma` o `prismaMaster` desde
 *    src/app/api/** (con whitelist).
 *
 * Fase 5 commit 16:
 *  - `no-feature-gate-on-core`: prohíbe `withFeature`/`withQuota`/
 *    `consumeQuota` en handlers del CORE (registro de jornada).
 *    Permite `hasFeature`/`getLimit` porque NO rechazan el fichaje
 *    (solo modifican comportamiento, ver plan §5.1 + §6.1).
 *  - `no-quota-writer-leak`: prohíbe `import { prismaQuotaWriter }`
 *    fuera de `src/lib/tenant/features.ts`. ADR-004 §2.2.
 *  - `route-must-use-withTenant`: rutas en src/app/api/** con export
 *    HTTP (GET, POST, ...) deben envolver el handler con `withTenant`.
 *    Whitelist: /api/auth, /api/webhooks, /api/onboarding, /api/health,
 *    /api/admin (panel super-admin).
 *
 * Auditoría de seguridad 2026-08-04:
 *  - `route-must-check-auth`: rutas en src/app/api/** con export HTTP
 *    deben comprobar la identidad de quien llama. `withTenant` NO
 *    autentica —solo cruza el JWT con el host cuando el JWT existe—, así
 *    que sin este guard una petición sin cookie entra. Dos endpoints se
 *    publicaron así (`/api/organigrama` servía la plantilla entera a un
 *    anónimo); la regla existe para que no vuelva a pasar en silencio.
 *    Todo lo público de verdad va a la whitelist CON motivo escrito.
 */
const fichajePlugin = {
  rules: {
    "no-legacy-prisma": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Prohíbe importar `prisma` o `prismaMaster` en src/app/api/** salvo whitelist.",
        },
        schema: [],
      },
      create(context) {
        const EXEMPT_PATHS = [
          "/api/auth/",
          "/api/webhooks/",
          // /api/onboarding/status/* vive en subdominio app (lookup
          // por session_id post-checkout). Resto de /api/onboarding/
          // es tenant-scoped y ya migró a prismaApp + withFeature.
          "/api/onboarding/status/",
          // /api/configuracion/dominio modifica master.tenants
          // (control plane), no datos del tenant. Plan Fase 6 §4.5.
          "/api/configuracion/dominio",
          // /api/admin/** es el panel super-admin: opera sobre master
          // (tenants, audit_log, super_admins). Plan Fase 7.
          "/api/admin/",
          // /api/me/api-tokens gestiona master.api_tokens. Plan D.1.
          "/api/me/api-tokens",
          // /api/configuracion/auditoria lee master.audit_log filtrado
          // por tenant. Plan D.6.
          "/api/configuracion/auditoria",
          // /api/billing/** lee master.subscriptions y dispara checkout
          // del tenant logueado. Las suscripciones viven en master
          // (control plane), no en el schema del tenant.
          "/api/billing/",
          // /api/cron/** son endpoints de plataforma (autenticados con
          // CRON_SECRET) que iteran sobre master.tenants y reanidan
          // runWithTenant para cada uno. Necesitan prismaMaster.
          "/api/cron/",
        ];
        return {
          ImportDeclaration(node) {
            if (node.source.value !== "@/lib/prisma") return;
            const filename = context.filename || context.getFilename();
            const relevant =
              filename.includes("/src/app/api/") ||
              filename.includes("\\src\\app\\api\\");
            if (!relevant) return;
            const isExempt = EXEMPT_PATHS.some((p) => filename.includes(p));
            if (isExempt) return;
            for (const spec of node.specifiers) {
              if (spec.type !== "ImportSpecifier") continue;
              const name = spec.imported && spec.imported.name;
              if (name === "prisma" || name === "prismaMaster") {
                context.report({
                  node: spec,
                  message: `'${name}' no debe importarse en src/app/api/**. Usa 'prismaApp' (operaciones del tenant) o 'prismaRuntime'/'prismaQuotaWriter' según el caso. ADR-002 §2.2.`,
                });
              }
            }
          },
        };
      },
    },

    "no-feature-gate-on-core": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Prohíbe withFeature/withQuota/consumeQuota en handlers del CORE (registro de jornada). RD 8/2019 obliga a que el registro de jornada sea SIEMPRE accesible. hasFeature/getLimit sí están permitidos porque solo modifican comportamiento (ver fichajes/route.ts: geofencing + historial_meses).",
        },
        schema: [],
      },
      create(context) {
        const CORE_PATHS = [
          "/src/app/api/fichajes/",
          "/src/app/api/empleado/fichajes/",
          "/src/app/api/empleado/registro/",
          "/src/app/api/fichaje/registro-legal/",
        ];
        const filename = context.filename || context.getFilename();
        const isCore = CORE_PATHS.some((p) =>
          filename.includes(p) || filename.includes(p.replaceAll("/", "\\")),
        );
        if (!isCore) return {};
        const FORBIDDEN = new Set(["withFeature", "withQuota", "consumeQuota"]);
        return {
          ImportSpecifier(node) {
            const name = node.imported && node.imported.name;
            if (FORBIDDEN.has(name)) {
              context.report({
                node,
                message: `'${name}' no puede usarse en handlers del CORE (${filename}). RD 8/2019: el registro de jornada debe ser SIEMPRE accesible. Si necesitas modificar comportamiento sin rechazar, usa 'hasFeature'/'getLimit'.`,
              });
            }
          },
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type === "Identifier" && FORBIDDEN.has(callee.name)) {
              context.report({
                node: callee,
                message: `'${callee.name}()' no puede usarse en handlers del CORE. RD 8/2019.`,
              });
            }
          },
        };
      },
    },

    "no-quota-writer-leak": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Prohíbe importar `prismaQuotaWriter` fuera de src/lib/tenant/features.ts. Solo `consumeQuota` debe escribir tenant_quota_usage. ADR-004 §2.2.",
        },
        schema: [],
      },
      create(context) {
        return {
          ImportDeclaration(node) {
            if (node.source.value !== "@/lib/prisma") return;
            const filename = context.filename || context.getFilename();
            const isAllowed =
              filename.endsWith("/src/lib/tenant/features.ts") ||
              filename.endsWith("\\src\\lib\\tenant\\features.ts");
            for (const spec of node.specifiers) {
              if (spec.type !== "ImportSpecifier") continue;
              const name = spec.imported && spec.imported.name;
              if (name === "prismaQuotaWriter" && !isAllowed) {
                context.report({
                  node: spec,
                  message:
                    "'prismaQuotaWriter' solo puede importarse en src/lib/tenant/features.ts. Para consumir cuotas, usa la función exportada `consumeQuota`. ADR-004 §2.2.",
                });
              }
            }
          },
        };
      },
    },

    "route-must-use-withTenant": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Los exports HTTP en src/app/api/** (GET/POST/PUT/PATCH/DELETE) deben envolver el handler con withTenant. Whitelist: /api/auth, /api/webhooks, /api/onboarding, /api/health, /api/admin.",
        },
        schema: [],
      },
      create(context) {
        const EXEMPT_PATHS = [
          "/api/auth/",
          "/api/webhooks/",
          "/api/onboarding/",
          "/api/health/",
          "/api/admin/",
          // /api/cron/** son operaciones de plataforma que iteran
          // tenants y reanidan runWithTenant manualmente.
          "/api/cron/",
        ];
        const filename = context.filename || context.getFilename();
        const relevant =
          filename.includes("/src/app/api/") ||
          filename.includes("\\src\\app\\api\\");
        if (!relevant) return {};
        const isExempt = EXEMPT_PATHS.some((p) => filename.includes(p));
        if (isExempt) return {};
        const HTTP = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
        return {
          ExportNamedDeclaration(node) {
            const decl = node.declaration;
            if (!decl || decl.type !== "VariableDeclaration") return;
            for (const v of decl.declarations) {
              if (v.id.type !== "Identifier") continue;
              if (!HTTP.has(v.id.name)) continue;
              const init = v.init;
              if (!init) continue;
              // Buscar primera CallExpression cuyo callee sea Identifier
              // de un wrapper que internamente envuelve withTenant. Los
              // wrappers válidos son: withTenant directo o
              // withApiV1 (Plan D.1 — internamente llama withTenant).
              const VALID_WRAPPERS = new Set(["withTenant", "withApiV1"]);
              let cur = init;
              let found = false;
              for (let depth = 0; depth < 5 && cur; depth++) {
                if (cur.type !== "CallExpression") break;
                const callee = cur.callee;
                if (callee.type === "Identifier" && VALID_WRAPPERS.has(callee.name)) {
                  found = true;
                  break;
                }
                cur = cur.arguments && cur.arguments[0];
              }
              if (!found) {
                context.report({
                  node: v.id,
                  message: `'export const ${v.id.name} = ...' debe envolver el handler con 'withTenant(...)'. ADR-002 §6 + plan Fase 3 §11.`,
                });
              }
            }
          },
        };
      },
    },

    "route-must-check-auth": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Los handlers HTTP de src/app/api/** deben comprobar identidad. withTenant resuelve el tenant por el Host pero NO autentica: sin JWT deja pasar. Whitelist explícita para lo público de verdad.",
        },
        schema: [],
      },
      create(context) {
        // Rutas públicas a propósito. Cada entrada lleva su motivo: si algo
        // se añade aquí sin poder explicarse en una línea, probablemente sea
        // un bug y no una excepción.
        const EXEMPT_PATHS = [
          // NextAuth gestiona su propio flujo (login, callbacks, reset).
          "/api/auth/",
          // Firma HMAC / secret compartido del proveedor en vez de sesión.
          "/api/webhooks/",
          // Autenticados con CRON_SECRET, no con sesión de usuario.
          "/api/cron/",
          // Panel super-admin: cookie propia, fuera del NextAuth del tenant.
          "/api/admin/",
          // Liveness probe: sin datos.
          "/api/health/",
          // Alta de tenant y estado post-checkout: por definición pre-sesión.
          "/api/onboarding/",
          // Liveness probe: responde sin tocar datos del tenant.
          "/api/healthz",
          // Branding (nombre, colores, logo) — lo pinta la pantalla de LOGIN,
          // así que se sirve antes de que exista sesión. No expone PII: solo
          // la identidad visual que el tenant ya enseña en su portada.
          "/api/branding",
          // Candidatura a una oferta publicada: el candidato no tiene cuenta.
          "/api/ofertas/publica/",
        ];
        const filename = context.filename || context.getFilename();
        const relevant =
          filename.includes("/src/app/api/") ||
          filename.includes("\\src\\app\\api\\");
        if (!relevant) return {};
        const isExempt = EXEMPT_PATHS.some((p) =>
          filename.includes(p) || filename.includes(p.replaceAll("/", "\\")),
        );
        if (isExempt) return {};

        // Símbolos que acreditan quién llama. No todos son sesión NextAuth:
        // una API key, un secret de servicio o un token HMAC firmado y de un
        // solo uso identifican igual de bien. Lo que la regla persigue es que
        // NO haya handlers que no comprueben nada.
        const AUTH_SYMBOLS = new Set([
          "auth",
          "getToken",
          "getServerSession",
          // API pública por API key (withApiV1 valida el token).
          "withApiV1",
          // Servicio interno entre procesos (secret compartido).
          "requireServiceAuth",
          // Botón de acción en un email: token HMAC con TTL y single-use.
          "verifyFeedbackActionToken",
          // Denuncia anónima: el informante se acredita con el accessToken
          // que solo él tiene (la BD guarda el sha256, no el token).
          "hashAccessToken",
        ]);
        const HTTP = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
        let checksAuth = false;
        const httpExports = [];

        return {
          ImportSpecifier(node) {
            const name = node.imported && node.imported.name;
            if (AUTH_SYMBOLS.has(name)) checksAuth = true;
          },
          // Algunos endpoints de plataforma comparan un secret a pelo contra
          // `process.env.X_SECRET` sin importar ninguna función (p.ej. el
          // watchdog con CRON_SECRET). También cuenta como comprobación.
          MemberExpression(node) {
            if (node.object.type !== "MemberExpression") return;
            const o = node.object;
            if (
              o.object.type !== "Identifier" || o.object.name !== "process" ||
              o.property.type !== "Identifier" || o.property.name !== "env"
            ) return;
            const prop = node.property;
            if (prop.type === "Identifier" && /_SECRET$/.test(prop.name)) {
              checksAuth = true;
            }
          },
          ExportNamedDeclaration(node) {
            const decl = node.declaration;
            if (!decl) return;
            if (decl.type === "VariableDeclaration") {
              for (const v of decl.declarations) {
                if (v.id.type === "Identifier" && HTTP.has(v.id.name)) {
                  httpExports.push(v.id);
                }
              }
              return;
            }
            // `export async function GET(...)`, estilo de los webhooks.
            if (decl.type === "FunctionDeclaration" && decl.id && HTTP.has(decl.id.name)) {
              httpExports.push(decl.id);
            }
          },
          "Program:exit"() {
            if (checksAuth) return;
            for (const id of httpExports) {
              context.report({
                node: id,
                message: `'${id.name}' no comprueba identidad. 'withTenant' resuelve el tenant por el Host pero NO autentica: sin cookie la petición entra igual. Añade 'const session = await auth()' + 401, o añade la ruta a EXEMPT_PATHS con el motivo escrito. Auditoría 2026-08-04.`,
              });
            }
          },
        };
      },
    },
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
  {
    plugins: { fichaje: fichajePlugin },
    rules: {
      "fichaje/no-legacy-prisma": "error",
      "fichaje/no-feature-gate-on-core": "error",
      "fichaje/no-quota-writer-leak": "error",
      "fichaje/route-must-use-withTenant": "error",
      "fichaje/route-must-check-auth": "error",
    },
  },
  // Tests: las reglas custom NO aplican (los tests importan/mockean
  // los clientes Prisma para configurar mocks).
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.integration.test.ts"],
    rules: {
      "fichaje/no-legacy-prisma": "off",
      "fichaje/no-quota-writer-leak": "off",
      "fichaje/route-must-use-withTenant": "off",
      "fichaje/route-must-check-auth": "off",
    },
  },
]);

export default eslintConfig;
