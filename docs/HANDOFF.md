# Handoff — estado del proyecto a 2026-05-13 (post-sesión Sprint 4)

Documento para retomar el trabajo desde otra cuenta de Claude (o
máquina). Resume lo que hay en marcha, decisiones recientes y
operativa básica. Para reglas de código permanentes ver `AGENTS.md`.

> **Actualización 2026-05-27** (solo lectura de estado, sin cambios de
> código): ya hay **3 tenants reales** en prod (la BD dejó de estar
> vacía). El provisioning E2E quedó confirmado por `mobileshop`. Ver
> §3 (tabla de tenants) y §7.0 (pendiente 🔴 cerrado).

---

## 1. Qué es esto

`empleaIA` — SaaS multi-tenant de fichaje + RR.HH. Repos:

- **App**: este repo (`tecnocloudes/fichaje`), Next.js 16.2.3 +
  Prisma 7.7.0 + NextAuth v5.
- **Landing**: `tecnocloudes/empleaia-landing` (Astro), en
  `~/Claude Code/Proyectos Claude/empleaia-landing`.

Branch activa: `feature/saas-migration`. Aún sin merge a `main`.
Producción ya corre desde esta rama vía Dokploy.

## 2. Infraestructura producción

- VPS: `185.47.13.172`, SSH `root@185.47.13.172 -p 5251`.
- Orquestador: **Dokploy** + Docker Swarm + Traefik.
  - Apps registradas: `empleaia-app` (id Dokploy `kbhSgmRPJZqRLvgD8g6ps`),
    `Landing` (`N4V7HU9dcWDwt9iheOSBh`).
  - Logs deploy: `/etc/dokploy/logs/<container-name>/*.log`.
  - Repo clonado por Dokploy: `/etc/dokploy/applications/empleaia-empleaiaapp-apdwzc/code`.
  - Auto-pull desde GitHub al push, **rebuild manual no automático** —
    si el último deploy falla, hay que dispararlo desde la UI Dokploy
    o esperar al siguiente push.
- Postgres: contenedor `empleaia-empleaia-xwe3vi.1.…`, DB `empleaia`,
  usuario `empleaia`. Una sola DB para todos los tenants vía schemas.
- Dokploy Postgres aparte: `dokploy-postgres.1.…`, DB `dokploy` (lista
  applications + deployments).

### Dominios
- `empleaia.es` — landing Astro (`empleaia-landing-awz1iy`).
- `app.empleaia.es` — registro y checkout Stripe.
- `<slug>.empleaia.es` — tenant (ej. `tecnocloud.empleaia.es`).
- `admin.empleaia.es` — panel super-admin.

## 3. Multi-tenant — recordatorio breve

- 2 schemas Prisma: `prisma/schema.prisma` (control plane `master.*`,
  cliente `prismaMaster`/`prismaRuntime`) y `prisma/schema-tenant.prisma`
  (producto `tenant_<slug>.*`, cliente `prismaApp` — Proxy multiplexado
  por tenant via `runWithTenant`).
- Tenants en prod (a **2026-05-27**): **3 registrados** en
  `master.tenants` — 2 activos con schema provisionado + 1 `pending`
  abandonado. (El wipe del 12-may dejó la BD vacía; estas son las
  primeras altas reales por `app.empleaia.es/registro`.)

  | slug | nombre | estado | plan | suscripción | alta |
  |---|---|---|---|---|---|
  | `mobileshop` | Mobileshop Comunicaciones | active | enterprise | `active` (periodo→26-jun) | 12-may |
  | `manuel` | Manuel | active | enterprise | `trialing` (**trial vence 27-may 09:46**) | 13-may |
  | `asdasd` | dasdas | pending | — | sin suscripción | 13-may |

- Schemas existentes: `tenant_mobileshop`, `tenant_manuel` y
  `tenant_template` (plantilla limpia para clonar). **No existe
  `tenant_asdasd`**: el alta se quedó en `pending` sin llegar a
  provisionar (sin `stripe_customer_id`). Candidato a limpiar.
- ⚠️ `manuel` está en trial que **vence hoy 27-may**: si no convierte,
  Stripe lo pasará a `past_due`/`canceled` y `withTenant` empezará a
  responder 402 (`suspended`). Vigilar.
- Ver `AGENTS.md` — incluye reglas críticas (handlers usan
  `withTenant`, pages usan `withTenantPage`, no `fetch` interno entre
  rutas, etc.).

## 4.0. Lo último que hicimos (sesión Sprint 4 — 2026-05-13)

3 commits en `feature/saas-migration` cierran todos los pendientes
🟢 + 🟣 que quedaban abiertos del §7.0 anterior (todo menos Stripe LIVE):

- `6b3399e` **feat(mvp): chat SSE, WhatsApp worker, multi_empresa, Slack/Google, Cobee**.
  Bloque de los MVPs grandes — ver §7.cua y §7.qui.
- `a81709b` **feat(prenomina): salario por empleado, marcar enviada, export Sage/A3**.
  Cierra las 3 mejoras Enterprise pendientes — ver §7.qua (actualizado).
  Nueva migración formal `20260513120000_user_salario_y_prenomina_enviada`.
- `f21fd8f` **chore(tech-debt): retirar runMigrations + UI retencionFotosDias**.
  `src/lib/migrate.ts` eliminado; 17 callsites de `import { runMigrations }`
  y sus llamadas (no-ops) limpiadas. Configuración → General ahora tiene
  input para `retencionFotosDias` cuando `faceIdGuardarFoto` está ON.

### Estado al cerrar 2026-05-13

- ✅ Sprint 4 desplegado (auto-pull Dokploy al push). El entrypoint
  aplica `20260513120000_user_salario_y_prenomina_enviada` a
  `tenant_template` automáticamente; en BD wipeada (0 tenants) el
  primer alta nueva ya nace con el schema completo.
- ✅ Cero pendientes 🟢/🟣 del HANDOFF anterior.
- ⚠️ Sigue pendiente: verificación E2E real del provisioning post-wipe
  (alta nueva por `app.empleaia.es/registro`). Confirmaría el cierre
  del incidente "mobileshop" 12-may, ahora con migración formal
  consolidada **y** las nuevas columnas Sprint 4.
- ⚠️ Sigue pendiente: Stripe LIVE para empezar a cobrar.

### Env vars nuevas para activar los MVPs

Estas son opcionales — los módulos funcionan en modo "encolado/
simulado" sin ellas, pero el envío real requiere:

- `WHATSAPP_VERIFY_TOKEN` (en Dokploy `empleaia-app`): cualquier string
  random. Se introduce en Meta App Dashboard → WhatsApp → Webhooks como
  "Verify token" al registrar la URL `https://<slug>.empleaia.es/api/webhooks/whatsapp/<slug>`.
- `WHATSAPP_APP_SECRET` (en Dokploy): App Secret del App de Meta. Se usa
  para validar la firma HMAC del webhook (`X-Hub-Signature-256`). Si no
  está definido, el webhook acepta sin validar (modo dev).

Por tenant (en `WhatsappConfig` desde `/admin/whatsapp-bot`):
- `phoneNumberId` (Meta WhatsApp Business Account → Phone Number ID).
- `tokenEnc` (access token de la WhatsApp Business System User; se
  cifra automáticamente con AES-GCM al guardar).
- `activo = true` para que el POST a `/api/whatsapp/mensajes` envíe
  inmediato en lugar de solo encolar.

Por tenant en marketplace (cada `IntegracionInstalada.configuracion`):
- **Slack**: `{ webhookUrl, canal? }`. La webhookUrl la genera el OWNER en
  api.slack.com/apps → Incoming Webhooks. Cualquier solicitud de
  ausencia dispara un ping al canal.
- **Google Workspace**: `{ accessToken, customer?, domain? }`. Token
  OAuth con scope `admin.directory.user.readonly`. Para probar rápido,
  generar uno en OAuth Playground. POST `/api/marketplace/google/sync-users`
  importa empleados.
- **Cobee**: `{ apiKey, baseUrl?, companyId? }`. Sin instalar,
  `/api/retribucion/emitir` devuelve modo simulado con el desglose.

## 4.bis. Lo penúltimo que hicimos (sesión maratón 2026-05-12)

Sesión muy larga con 7 entregas + 1 incidente resuelto. Commits en
`feature/saas-migration` (más reciente arriba):

- `a25bc3e` **feat(prenomina): persistida con estados, conceptos y reglas**.
  Convierte la prenómina de agregación on-the-fly a snapshot
  Enterprise-ready. Migración formal `20260512190000_prenomina_persistida`
  con tablas `Prenomina` + `PrenominaConcepto`, 10 columnas de reglas en
  `ConfiguracionEmpresa`. Workflow BORRADOR → CERRADA → ENVIADA. UI
  `/admin/nominas` reescrita con métricas, modal detalle y conceptos
  editables. Tab "Nómina" añadido en `/admin/configuracion`. Ver §7.qua.
- `923da61` docs(handoff): consolidación de lazy migrations a formales.
- `b940025` **refactor(migrate): consolidar lazy migrations a formales**.
  `src/lib/migrate.ts` queda como no-op. Toda la lógica de Sprint 3 en
  migración formal `20260512170000_sprint3_lazy_to_formal`. Ver §7.ter.
- `d2d1759` fix(provisioning): ejecutar runMigrations en aprovisionamiento.
  Fix temporal del incidente `mobileshop` (12-may): el provisioning del
  webhook creaba el OWNER user antes de las lazy migrations → ColumnNotFound
  en `empresaId`. Solución temporal: llamar `runMigrations()` dentro de
  `runWithTenant` del checkout. Fix permanente: `b940025`. Ver memoria
  `feedback_provisioning_lazy_migrations`.
- `be65dea` **feat(auth): flujo de recuperar contraseña en /recuperar-password**.
  Nueva página pública + endpoint con respuesta uniforme contra user
  enumeration. Email descartado silenciosamente si SMTP del tenant no
  configurado. Enlace en TenantLoginForm.
- `3f52705` docs(handoff): cutover wildcard *.empleaia.es via IONOS DNS-01.
- `0b46abf` **feat(empleados): ficha 360º del empleado en /admin/empleados/[id]**.
  Server component con `withTenantPage` + componente cliente con tabs
  (Fichajes 30d / Ausencias 12m / Próximos turnos). Cabecera con datos
  personales + sede + manager + empresa. 4 métricas. Acceso OWNER/MANAGER.
- `8f11ab9` *(de sesión previa: docs handoff)*.

### Operativa "no-código" del 12-may

1. **Cutover wildcard `*.empleaia.es`** desplegado en Traefik (ver §7.bis).
   API Key IONOS en `/etc/dokploy/ionos.env` (modo 600). Cualquier tenant
   nuevo responde con cert válido **sin tocar Dokploy**.
2. **Rotación API Key IONOS** completada (la 1ª clave quedó en chat por
   error; revocada en IONOS y reemplazada en VPS).
3. **Wipe completo de datos de prueba** (BD + Stripe + Dokploy):
   - DROP SCHEMA tenant_ucm, tenant_tecnocloud + DELETE master.tenants/
     tenant_features/subscriptions/quota_usage
   - Backup pg_dump en `/etc/dokploy/backups/wipe-20260512-164753.sql.gz`
   - Stripe: canceladas 8 subs huérfanas (test mode). 0 active, 0 trialing
   - Dokploy: borrados 4 Domains (tecnocloud, ucm, manolo, dev). Quedan
     solo `app`, `admin`, `empleaia.es`, `www.empleaia.es`
4. **Incidente `mobileshop`**: alta nueva post-wipe se atascó en
   provisioning con ColumnNotFound. Resuelto en caliente con SQL manual
   (rescate en commit `d2d1759`). Solución estructural en `b940025`.

### Estado al cerrar 2026-05-12 (madrugada)

- ✅ Wildcard operativo: cualquier `<slug>.empleaia.es` funciona al
  instante en cuanto el tenant existe en `master.tenants`.
- ✅ Provisioning robusto: nuevas altas via /registro deberían completar
  end-to-end sin atascos. **Pendiente verificar E2E real** con un alta
  fresca (no se llegó a probar tras el commit `b940025` final).
- ✅ Prenómina Enterprise-ready desplegada (commit `a25bc3e` deployando
  al cerrar la sesión).
- ⚠️ BD limpia, 0 tenants, listo para primer cliente real.

## 4. Lo último que hicimos (sesión 2026-05-08 → 2026-05-10)

Commits relevantes en `feature/saas-migration` (más reciente arriba):

- `1a21efc` feat(objetivos): implementar módulo OKRs (pro+enterprise).
  Modelo `Objetivo` + endpoints + UI grid de cards con slider de
  progreso. Lazy migration añade tabla. Reactiva la feature `objetivos`
  en BD para pro+enterprise.
- `82269cc` feat(informes): split básico/avanzado gateado por
  `informes_avanzados`. Listado de fichajes en todos los planes (RD
  8/2019); resumen + gráficos + ausencias/turnos solo pro+.
- `d13df5d` chore(pricing): saneamiento de la pricing table —
  `plan-pricing.ts` ahora solo promete features que funcionan
  (eliminadas las 14 latentes).
- `cf9a154` docs(handoff): documentar gating de planes y cierre de 4
  gates.
- `54c3fcd` feat(latentes): MVP funcional para las 6 features
  marketing-only restantes — `chat` (polling 4s), `whatsapp_bot`
  (cola + config Cloud API sin worker), `marketplace` (8
  integraciones seedeadas, activación lógica), `multi_empresa`
  (Empresa+CIF, etiquetado), `prenomina` (agregado on-the-fly de
  Fichaje, CSV), `retribucion_flex` (4 conceptos con ahorro IRPF
  estimado 30 %). Activadas en pro+enterprise (whatsapp_bot solo
  enterprise). Catálogo 56 features → 55 activas + 1 deferred
  (`sso_saml` Fase 9). **PENDIENTE verificar deploy**: 9 tablas
  nuevas (Conversacion, ParticipanteConversacion, Mensaje,
  WhatsappConfig, MensajeWhatsapp, Integracion, IntegracionInstalada,
  Empresa, DeclaracionFlex) deben aparecer en `tenant_tecnocloud`
  tras auto-pull Dokploy. Procedimiento §5.1.b.
- `b972fc6` feat(plans): cerrar 4 gates de plan que usaban toggles
  locales en lugar de `hasFeature()`. Detalle en §5.6 abajo.
- `386c70c` docs(handoff): cerrar auditoría (cron de purga activo).
- `f48c093` chore(deploy): trigger redeploy para inyectar
  `CRON_SECRET` (commit empty para forzar build con env nuevo en
  Dokploy).
- `0bfcc87` chore(seguridad): auditoría — 9 vulnerabilidades cerradas
  (HIGH×5 + MEDIUM×4). Face ID client-trust → token HMAC single-use,
  IDOR en tareas/comunicados/articulos, rate limit + lockout en login
  y face verify, AES-GCM authTagLength, Cache-Control no-store en
  biometría, cron de purga RGPD, deps (nodemailer fuera +
  xlsx→exceljs). Detalle en §5.5 abajo.
- `cfc598d` fix: toggle no se comprime con labels largos (shrink-0).
- `5394296` feat(face-id): **snapshot cifrado al fichar** (toggle por
  empresa). RGPD art. 9. AES-256-GCM con `IA_ENCRYPTION_KEY`.
- `d475895` feat(informes): filtros sede + empleado, vista detalle de
  fichajes con geolocalización (link a Google Maps).
- `5db94a3` fix(build): separar `detectDeviceTypeFromUA` en módulo
  server-safe. Caso recurrente: importar desde `@/lib/device` (que
  exporta `useDeviceType` con React) desde un route handler hace
  caer todo el build con Turbopack.
- `ba721ee` device gating server-side (móvil/tablet) + emails
  ausencias con branding del tenant.
- `064c76e` ausencias: emails de solicitud (a managers + OWNERs) y
  resolución (al empleado). Face ID obligatorio funciona de verdad.
- `bab1fa9` fix: hidratar listas con array directo (los GET de
  `/api/ausencias` y `/api/ausencias/tipos` devuelven array, no
  `{tipos:[...]}` como leían los clientes).
- `9c8e163` fix: lazy migrate cualifica schema (los ALTER iban a
  `public`, fallaban con `relation does not exist`). Tipos de
  ausencia editar/borrar.
- `5b3c7bc` runMigrations cacheada por slug + llamada en PUT
  configuracion y POST fichajes.
- `5f79fed` trial banner solo OWNER + geo se refresca al permitirla.
- `5bcf2ac` /perfil + toggles geo/face id + sidebar limpio por plan.

## 5. Convenciones aprendidas en esta sesión (importantes)

### 5.1. SQL crudo en lazy migrations
`prisma.$executeRawUnsafe(...)` NO usa el `schema:` configurado en
`PrismaPg`, aunque sí lo usan las queries del modelo. **Siempre
cualificar** con `"tenant_<slug>"."Tabla"`. Ver `src/lib/migrate.ts`.
Búsquedas en `pg_constraint` deben filtrar por `nspname` para no
pisar entre tenants.

**Trampa idempotencia detectada 2026-05-11**: el patrón
`IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=...)`
falla cuando el nombre existe como **índice** (`pg_class`) pero NO
como constraint (`pg_constraint`). Sucede si la migración formal
inicial creó la columna con `@unique` Prisma: Prisma genera un
índice unique con ese nombre sin entrada en `pg_constraint`. Cuando
la lazy migration intenta hacer `ALTER TABLE ADD CONSTRAINT` con el
mismo nombre, choca con el índice existente. El error queda
silenciado por el `try/catch` general de `runMigrations` y **NINGUNA
migración posterior se aplica** (la BD queda en estado intermedio).

Patrón correcto para UNIQUE constraints en lazy migrations:

```sql
DO $$ BEGIN
  ALTER TABLE schema."Tabla" ADD CONSTRAINT "name_key" UNIQUE ("col");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;
```

Para FK (`pg_constraint` siempre los registra) el patrón
`IF NOT EXISTS` sí funciona. Fix aplicado en commit `06b1527`.

### 5.1.b. Verificación obligatoria tras deploy con modelos nuevos
**Síntoma observado 2026-05-11**: Dokploy reportó `status: done` en
los commits `1a21efc` (objetivos), `34db7d0` (encuestas) y `16e6592`
(6 features batch), pero las 11 tablas correspondientes NO existían
en `tenant_tecnocloud` porque la lazy migration estaba bloqueada
por el bug de §5.1. El producto compilaba y servía la UI, pero
cualquier query a las nuevas features fallaba en runtime con
`relation does not exist`.

**Procedimiento**: tras desplegar un commit que añade modelos al
schema, verificar con:

```bash
ssh -p 5251 root@185.47.13.172 \
  "docker exec empleaia-empleaia-xwe3vi.1.<id> \
   psql -U empleaia -d empleaia -c \
   \"SELECT table_name FROM information_schema.tables \
     WHERE table_schema='tenant_<slug>' \
       AND table_name IN ('Modelo1','Modelo2',...);\""
```

Si NO aparecen, mirar logs del servicio (`docker service logs
empleaia-empleaiaapp-apdwzc | grep migrate`) para detectar el error
silenciado. Forzar las migraciones llamando a un endpoint que las
dispare (`curl /api/<feature>` aunque devuelva 401, `runMigrations`
se ejecuta antes del check de auth).

### 5.2. Endpoints que devuelven arrays
Varios GET (`/api/ausencias`, `/api/ausencias/tipos`, etc.) devuelven
`Response.json(array)` directo, no `{items:[...]}`. El cliente debe
usar `Array.isArray(data) ? data : (data?.items ?? [])`.

### 5.3. Server vs client en `lib/`
Si un archivo de `src/lib/` exporta un hook React (incluye
`useEffect/useState`), Turbopack lo marca como client-only. Si lo
importa un route handler, **el build entero peta**. Patrón: separar
funciones puras a `lib/<modulo>-server.ts` (o `-ua.ts`, etc.). Caso
de referencia: `device.ts` (cliente), `device-ua.ts` (server),
`device-types.ts` (tipo compartido).

### 5.4. Aplicar SQL urgente en producción
Cuando un deploy aún no está y el bug bloquea producción, se aplica
ALTER manualmente:

```bash
ssh -p 5251 root@185.47.13.172 \
  "docker exec empleaia-empleaia-xwe3vi.1.<id> \
     psql -U empleaia -d empleaia -c '<SQL>'"
```

Lista contenedores con `docker ps`, busca el de Postgres del producto
(no `dokploy-postgres`).

### 5.5. Auditoría de seguridad (cambios estructurales)

#### Face ID server-side
- Antes: `POST /api/fichajes` confiaba en `body.faceVerified: boolean`
  del cliente. Bypasseable enviando `{faceVerified: true}` sin pasar
  Face ID. Ahora: `POST /api/face/verify` emite `faceVerifyToken`
  (HMAC-SHA256 firmado con `IA_ENCRYPTION_KEY`, TTL 60s, single-use
  vía nonce in-memory). El cliente lo manda a `/api/fichajes` que
  llama `consumeFaceToken(token, userId, slug)`. Si falla, 400.
- Helpers: `src/lib/face/token.ts` (`issueFaceToken`/`consumeFaceToken`).
- Single-use sobrevive 90s (margen sobre el TTL 60s) en
  `globalThis._faceTokenNonces`. Si se escala a varias réplicas,
  migrar a Redis.

#### Rate limit + lockout
- `src/lib/rate-limit.ts` — store in-memory en `globalThis`. APIs:
  `checkRate(key, limit, windowMs)`, `isLocked(key)`,
  `recordFailure(key, threshold, lockoutMs)`, `clearFailures(key)`.
- Login (`src/lib/auth.ts` `authorize`): 10 intentos/min por IP +
  lockout tras 5 fallos en 15 min con key `login:slug:email:ip`
  (clave compuesta para evitar que un atacante desde otra IP bloquee
  al usuario legítimo).
- Face verify: 10 intentos/min por `user:ip`.
- Limitación: in-memory NO se comparte entre réplicas. Single-replica
  en Dokploy actual basta. Si se escala horizontalmente, migrar a
  Redis con la misma API.

#### IDOR cerrado en tareas/comunicados/articulos
- Antes: PUT/DELETE de `/api/tareas/[id]`, `/api/comunicados/[id]`,
  `/api/articulos/[id]` solo verificaban autenticación → cualquier
  EMPLEADO podía editar/borrar recursos ajenos del tenant.
- Ahora: comunicados y articulos requieren OWNER, MANAGER o
  `recurso.autorId === userId`. Tareas igual + caso especial: el
  empleado asignado puede marcar `completada` (y solo eso).

#### Purga biométrica RGPD
- Endpoint: `POST /api/cron/purge-biometrics` con
  `Authorization: Bearer ${CRON_SECRET}`. Itera `master.tenants`
  status=active, para cada uno reanida `runWithTenant` y borra
  `Fichaje.fotoSnapshotEnc` con `timestamp < now - retencionFotosDias`.
- Nuevo campo `ConfiguracionEmpresa.retencionFotosDias` (Int default
  90) — lazy migration en `migrate.ts`. Configurable por tenant en el
  futuro UI; por ahora 90 días para todos.
- ESLint whitelist: `/api/cron/` exento de `no-legacy-prisma` y
  `route-must-use-withTenant` (el patrón es de plataforma, no del
  tenant — usa `prismaMaster` para iterar tenants).
- **Acción operativa pendiente**: definir `CRON_SECRET` en Dokploy y
  programar cron externo (Dokploy/cron-job.org) que llame al endpoint
  diario. Hasta entonces los snapshots no se purgan.

#### Hardening menor
- AES-GCM (`src/lib/crypto/aes-gcm.ts`): `createDecipheriv` con
  `{ authTagLength: 16 }` — defensa en profundidad contra tags
  acortados.
- `/api/fichajes/[id]/foto`: `Cache-Control: private, no-store`
  (antes `max-age=300` permitía caché de navegador 5 min sobre dato
  biométrico).

#### Deps
- `nodemailer` y `@types/nodemailer` eliminados — no se usaba (el
  proyecto envía emails con Resend, ver `src/lib/email.ts`).
- `xlsx` → `exceljs` en `src/lib/informes/generators.ts`. `xlsx` tenía
  CVEs sin fix oficial (Prototype Pollution + ReDoS). El uso del
  proyecto era solo generación, no parsing, así que riesgo real bajo,
  pero exceljs es mantenido. **`generarExcel` ahora es async** — el
  caller (`/api/informes/exportar`) ya hace `await`.
- ExcelJS rechaza nombres de hoja duplicados case-insensitive: si
  `payload.tipo === "resumen"` la hoja extra de stats se llama
  "Estadísticas" (no "Resumen") para evitar colisión.

### 5.6. Gating de planes — feature en BD vs toggle local

Hay **dos capas de gating** distintas y no intercambiables:

1. **Feature de plan** (`master.features` + `master.plan_features`):
   controla qué módulos están disponibles según el plan contratado.
   Se consulta con `hasFeature("key")` o `withFeature("key", handler)`.
   Si el plan no la incluye → el módulo NO existe para ese tenant.
2. **Toggle local** (`ConfiguracionEmpresa.<flag>`): controla
   *comportamiento* dentro de un módulo ya contratado. P.ej., un
   OWNER del plan pro puede activar `faceIdObligatorio` para forzar
   Face ID en todos los empleados; otro OWNER del plan pro puede
   tenerlo apagado.

**Regla**: el toggle local SOLO debe respetarse si la feature del
plan está ON. Si la feature está OFF, el toggle se ignora (la UI lo
oculta y el backend hace como si estuviera apagado).

Auditoría 2026-05-11 encontró 4 features con módulo implementado
pero **sin chequeo de `hasFeature`** — un cliente "starter" podía
usarlas sin pagar. Fixed en `b972fc6`:

| Feature | Gate añadido |
|---|---|
| `face_id` | `withFeature("face_id")` en `/api/face/verify` y `/api/face/enroll`. `/api/face/status` devuelve `featureEnabled: false` si el plan no la tiene (no 402 — la pantalla de fichaje debe cargar). `/api/face/template/[userId]` DELETE permanece sin gate (derecho RGPD a borrar datos biométricos). En `/api/fichajes` el toggle `faceIdObligatorio` y `faceIdGuardarFoto` se ignoran si la feature está OFF. |
| `fichaje_movil` | En `/api/fichajes`: el toggle `fichajeMovilActivo=false` solo rechaza si `hasFeature("fichaje_movil")`. Sin feature, cualquier canal acepta el fichaje (RD 8/2019). |
| `fichaje_tablet` | Idem con `fichajeTabletActivo`. |
| `tareas` | `withFeature("tareas")` en `/api/tareas` (GET/POST) y `/api/tareas/[id]` (PUT/DELETE). |

Estado tras commits `82269cc` + `1a21efc`:
- `informes_avanzados`: **✅ cerrado** (`82269cc`). Split:
  - **Básico (todos los planes)**: `tipo=fichajes` + `tipo=presencia`.
    Cubre RD 8/2019.
  - **Avanzado (pro+enterprise)**: `tipo=resumen`, `tipo=ausencias`,
    `tipo=turnos`, `tipo=presencia-global`. Devuelven 402 en `/api/
    informes` y `/api/informes/exportar` si la feature está OFF.
  - UI: banner "Análisis avanzado disponible en plan Pro" cuando OFF.
    Bloques de stats/chart/tabla resumen ocultos; tabla plana de
    fichajes en su lugar.
  - **Afinamiento BD (2026-05-11)**: `plan_features.informes_avanzados`
    era `true` en starter por error histórico — el código gate-aba
    igual por TIPOS_AVANZADOS, pero el UI no sabía que iba a recibir
    402 y mostraba bloques avanzados rotos. Cambiado a `false` en
    starter (`true` en pro+enterprise). Ahora flag y comportamiento
    coinciden.
- `sso_saml`: deferred a Fase 9 (no hay endpoints aún).

**Patrón aprendido** — cuando añadas una feature nueva al catálogo
master, comprueba SIEMPRE que su gate `hasFeature("...")` aparece en
el handler real, no solo el toggle local en `ConfiguracionEmpresa`.

## 6. Toggles de tenant añadidos (Configuración → General)

- `geoObligatoria` — rechaza fichaje si no hay GPS (RD 8/2019: el
  fichaje no DEBERÍA bloquearse, pero si el OWNER lo decide se hace).
- `faceIdObligatorio` — los empleados con `FaceTemplate` deben pasar
  Face ID; los que no, ven CTA "Registrar Face ID" en `/empleado`.
- `faceIdGuardarFoto` — si se activa, al fichar con Face ID se
  almacena un snapshot 150×150 JPEG cifrado AES-GCM (key
  `IA_ENCRYPTION_KEY`) en `Fichaje.fotoSnapshotEnc`. Visible en
  `/admin/informes` (vista detalle empleado, columna Foto). Servido
  por `GET /api/fichajes/[id]/foto` (OWNER cualquier fichaje, MANAGER
  solo de su sede).
- `fichajeMovilActivo` / `fichajeTabletActivo` — gating server-side
  por User-Agent en `POST /api/fichajes`.
- `retencionFotosDias` (Int, default 90) — días de retención del
  snapshot biométrico antes de que el cron lo purgue. RGPD
  art. 5.1.e (minimización). No tiene UI todavía; se cambia con un
  UPDATE manual a `ConfiguracionEmpresa` por tenant si hace falta.

## 7.0. Pendiente al cerrar 13-may (próxima sesión empieza por aquí)

✅ **Verificación E2E real del provisioning** (CERRADO 2026-05-27):
- Confirmado por las altas reales `mobileshop` (12-may) y `manuel`
  (13-may): ambos están `active` con su schema (`tenant_mobileshop`,
  `tenant_manuel`) provisionado y suscripción enterprise. El flujo
  `app.empleaia.es/registro` → webhook checkout → provisioning va
  end-to-end sin atascos. Incidente "mobileshop" del 12-may **cerrado
  definitivamente**.
- Nota: el alta `asdasd` quedó en `pending` sin schema — pero por
  abandono del usuario (no llegó a pagar/completar checkout), no por
  fallo del provisioning.

🟡 **Stripe a modo LIVE** (necesario antes de cobrar a cliente real) —
runbook completo, EN CURSO desde 2026-05-27. Cuenta Stripe ya activada
para cobros reales (confirmado por el usuario).

**Diagnóstico (auditoría 2026-05-27):** la integración está bien hecha
para el cutover — los price IDs NO están hardcodeados, vienen de env
vars `STRIPE_PRICE_*`; el cliente lee `STRIPE_SECRET_KEY` y el webhook
`STRIPE_WEBHOOK_SECRET`. Cambiar a LIVE = recrear productos/precios +
webhook en la cuenta LIVE + cambiar env vars en Dokploy. Sin tocar
lógica.

**Modelo de pricing real (verificado en los precios test de prod):**
per-seat `billing_scheme=per_unit`, `unit_amount` = precio POR EMPLEADO
(starter 400 / pro 500 / enterprise 600 cents = 4/5/6 €/empleado/mes).
El mínimo de `MIN_BILLABLE_SEATS=15` usuarios lo aplica el backend
(`calculateQuantity` en `checkout.ts`), NO Stripe (`transform_quantity`
None). Fuente de verdad: `src/lib/billing/plan-pricing.ts`. El flujo de
alta y de cambio de plan usan SOLO el price `_MONTHLY` del plan; yearly
y addons no se usan todavía.

⚠️ **Trampa cerrada:** `scripts/stripe-bootstrap.ts` antes creaba
precios FLAT 39/49/99 € (desalineados con el modelo per-seat →
cobraría 15×39). Commit `6fa9381` (2026-05-27) lo corrige: ahora deriva
de `plan-pricing.ts` (per_unit correcto) y añade guarda LIVE — con
`sk_live` aborta salvo `STRIPE_BOOTSTRAP_ALLOW_LIVE=1`. Los precios test
los creó el usuario A MANO en dashboard, no con el script viejo.

**Estado actual en Dokploy `empleaia-app`** (todas las STRIPE_* en
TEST): `STRIPE_SECRET_KEY` (sk_test), `STRIPE_PUBLISHABLE_KEY` (pk_test),
`STRIPE_WEBHOOK_SECRET` (whsec test), y solo 3 precios:
`STRIPE_PRICE_{STARTER,PRO,ENTERPRISE}_MONTHLY`. Los `_YEARLY` y todos
los `STRIPE_PRICE_ADDON_*` NO están configurados (ni en test).

**Runbook (pasos del usuario — requieren login Stripe + secretos):**

1. **Claves LIVE**: dashboard.stripe.com (toggle en *Live*) → Developers
   → API keys. Copiar `sk_live_…` y `pk_live_…`. ⚠️ Nunca pegarlas en
   el chat de Claude (riesgo de quedar en transcript → rotación).
2. **Crear productos/precios en LIVE** — en terminal propia (no `!` en
   sesión Claude, para que la sk_live no entre al historial):
   ```bash
   STRIPE_SECRET_KEY=sk_live_XXXX STRIPE_BOOTSTRAP_ALLOW_LIVE=1 \
     npm run stripe:bootstrap
   ```
   Emite ~13 líneas `STRIPE_PRICE_*=price_…` (NO secretas). Solo hacen
   falta los 3 `_MONTHLY` para el flujo actual.
3. **Webhook LIVE**: Developers → Webhooks → Add endpoint. URL
   `https://app.empleaia.es/api/webhooks/stripe`. Los **9 eventos** que
   escucha `src/lib/stripe/dispatch.ts`: `checkout.session.completed`,
   `checkout.session.expired`, `customer.subscription.{updated,deleted,
   paused,resumed,trial_will_end}`, `invoice.payment_{succeeded,failed}`.
   Copiar el *Signing secret* `whsec_…` (secreto → directo a Dokploy).
4. **Env vars en Dokploy** `empleaia-app` → Environment (backup del env
   antes): `STRIPE_SECRET_KEY`→sk_live, `STRIPE_PUBLISHABLE_KEY`→pk_live,
   `STRIPE_WEBHOOK_SECRET`→whsec del endpoint live,
   `STRIPE_PRICE_{STARTER,PRO,ENTERPRISE}_MONTHLY`→price_ live. Guardar →
   redeploy.
5. **Verificación**: confirmar modo live (env enmascarado) + precios live
   per_unit 4/5/6. Alta real de prueba — ⚠️ en LIVE las tarjetas de test
   (4242…) NO valen, usar tarjeta real (reembolsable). Comprobar webhook
   entregado (200) + tenant provisionado + subscription `active`.
6. **Tenants existentes**: mobileshop/manuel/asdasd tienen subs de TEST;
   al pasar a live la app deja de verlas. Re-suscribir mobileshop/manuel
   si son reales; borrar `asdasd`.

Helper para inspeccionar precios en Stripe sin exponer la key (desde el
host VPS, la key sale del env del contenedor): ver el patrón usado en la
auditoría — `docker exec "$APP" printenv STRIPE_SECRET_KEY` a variable +
`python3` con `urllib` contra `api.stripe.com/v1/prices/<id>` (el
contenedor app NO tiene curl ni python3; usar el python3 del host).

🟢 **Cerrados en Sprint 4 (2026-05-13)** — ver §4.0:
- Prenómina: salario por empleado, marcar enviada, exports Sage/A3.
- `chat` polling → SSE server-side.
- `whatsapp_bot` worker real (cliente Cloud API + webhook).
- `multi_empresa` aislamiento real (scope por empresaId).
- `marketplace`: Slack (incoming webhook) + Google Workspace
  (Directory API sync).
- `retribucion_flex`: integración Cobee (live + simulado).

🔵 **Deferred**:
- `sso_saml` Fase 9 (esperando primer Enterprise que lo pida).

🟣 **Tech debt restante** (ninguno crítico):
- Dashboard super-admin más completo en `admin.empleaia.es`.
- Migrar `rate-limit.ts` y face token nonces a Redis si se escala >1
  réplica en Dokploy.
- Mejorar el campo `MensajeWhatsapp.providerMessageId` (no existe hoy)
  para correlacionar status updates entrantes con el outbound original.
- Selector de empresa activa en cabecera (hoy `resolveEmpresaScope` usa
  el `empresaId` del User; falta UI para que el OWNER alterne entre
  vistas cuando es admin del grupo).

## 7.cua. Cambios Sprint 4 — MVPs grandes (2026-05-13, commit 6b3399e)

### Chat: polling → SSE
Endpoint `/api/chat/conversaciones/[id]/stream` con `text/event-stream`.
El servidor hace polling cada 2 s a Mensaje y emite los nuevos por el
stream; ping cada 15 s. Cliente migrado de `setInterval` a `EventSource`.
Sin sockets ni LISTEN/NOTIFY — pragmático y suficiente para Dokploy
single-replica.

### WhatsApp Cloud API
- `src/lib/whatsapp/cloud-api.ts`:
  - `sendWhatsappText(config, to, text)` → POST a Meta Graph v22.
  - `verifyWebhookSignature(body, header)` → HMAC-SHA256 con
    `WHATSAPP_APP_SECRET`.
  - `decodeWhatsappConfig(...)` descifra `tokenEnc` con AES-GCM.
- POST `/api/whatsapp/mensajes` envía inmediato si `WhatsappConfig.activo`
  y deja el `MensajeWhatsapp` con estado `enviado` o `fallido`.
- Webhook `/api/webhooks/whatsapp/[slug]`:
  - GET: verificación Meta (hub.mode/hub.verify_token/hub.challenge).
  - POST: parsea `entry[].changes[].value.messages` y guarda inbound
    como `MensajeWhatsapp` estado `recibido` dentro de `runWithTenant`.
- ESLint whitelist `/api/webhooks/` ya cubre el endpoint (no necesita
  `withTenant`).

### Aislamiento multi_empresa
`src/lib/multi-empresa/scope.ts`:
- `resolveEmpresaScope(session)` devuelve `{ empresaId | null }`.
- OWNER sin `empresaId` ve todo (admin del grupo); resto queda
  limitado a su empresa.
- Si la feature `multi_empresa` está OFF → null (sin filtro).
- Helpers: `userScopeFilter` (sobre User) y `fichajeScopeFilter`
  (sobre relación user→empresa).

Aplicado a:
- `/api/empleados` (listado).
- `/api/fichajes` (listado).
- `/api/ausencias` (listado).
- `/api/prenomina` GET (lista) y POST (cálculo solo para empleados
  de la empresa activa).

### Marketplace: Slack + Google Workspace
- **Slack** (`src/lib/marketplace/slack.ts`): `notifySlackIfInstalled(text)`
  lee la `webhookUrl` de `IntegracionInstalada.configuracion`. Disparada
  en `notifyAusenciaCreada` cuando un empleado solicita ausencia.
- **Google Workspace** (`src/lib/marketplace/google-workspace.ts`):
  `syncEmpleadosFromGoogle()` lee `accessToken` + opcional `customer`/
  `domain` de la config, llama Directory API paginado y upserta
  empleados (rol EMPLEADO, password=null, foto=thumbnailPhotoUrl).
- Endpoint: `POST /api/marketplace/google/sync-users` (OWNER).

## 7.qui. Cambios Sprint 4 — Cobee (retribución flexible)

`src/lib/marketplace/cobee.ts`: `emitirTicketsCobee(tickets[])` busca la
integración `cobee` en `IntegracionInstalada`:
- Con `apiKey` + opcional `baseUrl`/`companyId`: POST a
  `${baseUrl}/benefits/tickets` por cada ticket. Devuelve `enviados/
  fallidos/errores` + `providerRef` por ticket creado.
- Sin instalar: modo simulado con el desglose total que se EMITIRÍA.

Endpoint: `POST /api/retribucion/emitir?periodo=YYYY-MM` (OWNER + feature
`retribucion_flex`). Mapea cada `DeclaracionFlex` del periodo a un
`CobeeTicket` y delega en `emitirTicketsCobee`.

## 7.sex. Tech debt cerrado Sprint 4 (commit f21fd8f)

- `src/lib/migrate.ts` ELIMINADO. Los 17 callsites de
  `import { runMigrations } from "@/lib/migrate"` y sus `await
  runMigrations()` (no-ops desde b940025) están limpiados. Incluye
  `checkout-session-completed.ts` (también el bloque de comentario
  que justificaba la llamada).
- UI **retencionFotosDias** en Configuración → General. Input
  numérico (1-3650 días) condicional al toggle `faceIdGuardarFoto`.
  Validación server-side en PUT `/api/configuracion`.

## 7. Pendiente (en el momento del handoff anterior)

### Operativa post-auditoría (estado final)
- ✅ **`CRON_SECRET` configurado en Dokploy** (env var de
  `empleaia-app`). Backup del env pre-cambio en local:
  `/tmp/dokploy-backups/empleaia-app-env-pre-cron-secret.txt`.
- ✅ **Schedule `purge-biometrics-rgpd` activo en Dokploy**
  (`scheduleId=8RYAH18d1o88zy41`, cron `0 3 * * *` Europe/Madrid,
  type `dokploy-server`). Ejecuta el `script.sh` en
  `/etc/dokploy/schedules/empleaia-app/script.sh` (un curl con Bearer
  al endpoint de purga). Verificado manualmente: log produce
  `{"ok":true,"tenantsProcesados":2,"totalPurgado":0,...}`.
- ✅ **Lazy migrate aplicada** en tecnocloud + ucm — la primera
  llamada al cron disparó `runMigrations()` por cada tenant y añadió
  `retencion_fotos_dias` con defecto 90.
- ✅ **Face ID en producción verificado** — sesión 2026-05-10 con
  el usuario dueño: `/api/face/verify` emite token, `/api/fichajes`
  lo consume, snapshot cifrado guardado. Score 0.94, fichaje
  `cmp0b47pj000307nxj95wyvwx`.
- ✅ **Gates de plan cerrados** (commit `b972fc6`): 4 features que
  estaban "abiertas" para todos los planes ahora respetan el
  contrato. Detalle en §5.6.
- ⚠️ **Detalle Dokploy a recordar**: si en el futuro se crean
  schedules vía SQL directo (no UI), hay que crear manualmente el
  `script.sh` en `/etc/dokploy/schedules/<appName>/`. La UI lo
  regenera al guardar; el SQL puro no. Comprobado al insertar el
  schedule de purga.

### Hallazgos de auditoría sin atacar
- Los ~21 errores `no-explicit-any` que reporta ESLint en
  `src/app/api/fichajes/[id]/route.ts`, `tareas/route.ts`,
  `fichajes/route.ts` y otros — son `(session.user as any).rol`
  preexistentes. No son regresión. Limpieza tipográfica pendiente.
- 14 vulns transitivas npm restantes — cadena `next-pwa → workbox →
  serialize-javascript`, `dompurify`, `fast-uri`, `hono` (vía
  `@prisma/dev`), `@babel/plugin-transform-modules-systemjs`. Ninguna
  en el path crítico; se resuelven en upgrades futuros.
- Marketing-only features: **0 restantes**. Todas implementadas con
  MVP funcional (sesión 2026-05-11 batch final). Limitaciones MVP
  documentadas:
  - `chat`: polling cada 4s (no realtime websockets/SSE).
  - `whatsapp_bot`: encola mensajes en `MensajeWhatsapp` pero el
    envío real requiere worker externo contra WhatsApp Cloud API.
    Configurar credenciales en `/admin/whatsapp-bot`.
  - `marketplace`: catálogo seedeado con 8 integraciones (Slack,
    Google Workspace, Microsoft 365, Sage Nóminas, A3, Zoom,
    Factorial, Holded). La activación marca como "instalada" en
    `IntegracionInstalada`. Sincronización real con cada servicio
    queda pendiente.
  - `multi_empresa`: tabla `Empresa` con CIF + `User.empresaId`.
    Los datos siguen en el mismo schema tenant — es etiquetado +
    filtrado, no aislamiento por CIF.
  - `prenomina`: agregado on-the-fly de Fichaje (no tabla
    propia). Exporta CSV listo para Sage/A3/etc.
  - `retribucion_flex`: tabla `DeclaracionFlex` con 4 conceptos
    (tickets restaurante, guardería, transporte, seguro médico).
    Cálculo de ahorro IRPF estimado al 30 %. Sin emisión real
    de tickets — la integración con Cobee/Pluxee/Edenred queda
    fuera del MVP.
- 1 ⚠️ gate sin cerrar: `sso_saml` (Fase 9, sin endpoints).

### Pendiente externo
- ✅ **Landing Astro** alineada — commit `16170d7` en
  `tecnocloudes/empleaia-landing` saneó `src/components/Precios.astro`
  con los mismos bullets que `plan-pricing.ts`. Dokploy auto-pull
  desplegará `empleaia.es` con la versión correcta. El resto del
  repo (Funcionalidades, Soluciones, Hero, FAQ, legales) NO tenía
  menciones a features latentes — verificado por grep.

### Mejoras opcionales
- Limpiar `wallet` de tenants existentes en producción (la feature
  fue retirada, ya se borró de tecnocloud + ucm pero ojo si hay
  tenants nuevos):
  ```sql
  DELETE FROM master.tenant_features WHERE feature_key='wallet';
  DELETE FROM master.plan_features  WHERE feature_key='wallet';
  DELETE FROM master.features        WHERE key='wallet';
  ```
- Migrar la lógica lazy de `migrate.ts` a migraciones formales en
  `prisma/migrations-tenant/` cuando haya un momento tranquilo.
- Migrar `rate-limit.ts` y face token nonces a Redis si se escala
  horizontalmente (hoy single-replica en Dokploy → in-memory basta).
- UI para `retencionFotosDias` en Configuración → General.

## 7.qua. Prenómina Enterprise-ready (2026-05-12, commit a25bc3e)

Migración formal `20260512190000_prenomina_persistida` + UI + endpoints
convierten la feature `prenomina` de agregación on-the-fly a snapshot
persistido con workflow.

**Modelos nuevos** (`prisma/schema-tenant.prisma`):
- `Prenomina` (periodo × empleado): cifras calculadas (horas
  trabajadas/ordinarias/extras/nocturnas/festivas, días trabajados,
  días ausencia pagada/no pagada), desglose económico (salario base,
  importes de extras/nocturnidad/festivos/conceptos, total bruto),
  estado `EstadoPrenomina` (BORRADOR → CERRADA → ENVIADA), cerradaPorId.
- `PrenominaConcepto`: dieta, kilometraje, comisión, plus, bonus,
  deducción, otro. Editables sólo en BORRADOR.
- 10 columnas en `ConfiguracionEmpresa` con reglas: `nominaJornadaSemanal`,
  `nominaHoraExtraFactor`, `nominaPlusNocturnidadActivo` +
  `nominaNocturnidadDesde/Hasta`/`Factor`, `nominaPlusFestivoActivo` +
  `Factor`, `nominaSalarioBaseDefault`, `nominaMoneda`.

**Backend**:
- `src/lib/prenomina/calculo.ts` — función pura `calcularPrenomina` que
  hace el pareo de fichajes (ENTRADA/PAUSA/VUELTA_PAUSA/SALIDA) y
  desglosa horas. `aplicarImportes` aplica los multiplicadores con el
  salario base del empleado.
- `POST /api/prenomina?periodo=YYYY-MM` — recalcula y upserta solo las
  prenominas en BORRADOR (respeta CERRADAS/ENVIADAS).
- `GET /api/prenomina?periodo=` — lista persistida con conceptos.
- `POST /api/prenomina/[id]/cerrar` (OWNER/MANAGER) / `/reabrir` (OWNER).
- `POST/DELETE /api/prenomina/[id]/conceptos` con recálculo automático
  de `importeConceptos` y `totalBruto`.
- `GET /api/prenomina/exportar?formato=csv|xlsx` (exceljs reutilizado).

**UI**:
- `/admin/nominas` reescrita: 4 métricas en cabecera (empleados, días
  laborables, cerradas, total bruto) + tabla con estado por fila +
  modal detalle con grid de cifras, desglose económico y CRUD de
  conceptos manuales.
- Tab "Nómina" en `/admin/configuracion` con las reglas de cálculo.

**Limitaciones conocidas**:
- Festivos: el cálculo de horas festivas usa el modelo `Festivo` del
  tenant si existe. Si no hay festivos cargados, las horas festivas
  son 0 (no rompe). El import masivo de festivos se hace por la pestaña
  Calendario en Configuración.
- Salario base por empleado: hoy se aplica el `nominaSalarioBaseDefault`
  a TODOS. Falta columna `User.salarioBase` o tabla `SalarioEmpleado`
  para personalizar. No bloquea el MVP Enterprise.
- Estado ENVIADA: existe el enum y `enviadaAt` pero falta endpoint
  "marcar como enviada al gestor laboral" + tracking. Hoy se queda en
  CERRADA tras cerrar.

## 7.ter. Consolidación de lazy migrations a formales (2026-05-12)

`src/lib/migrate.ts` queda como **no-op** desde commit `b940025`. Todo
lo que vivía allí (740 líneas de ALTER/CREATE TABLE para empresaId,
Conversacion, WhatsappConfig, Integracion + seed de 8 integraciones,
DeclaracionFlex, PreferenciasNotificacion, PushSubscripcion, Objetivo,
Encuesta, RespuestaEncuesta, Evaluacion, Gasto, EspacioReservable,
ReservaEspacio, NominaArchivo, Curso, AsignacionCurso, Peticion y
columnas extra de ConfiguracionEmpresa) se ha movido a una sola
migración formal:

```
prisma/migrations-tenant/20260512170000_sprint3_lazy_to_formal/
  migration.sql   (~450 líneas, idempotente con IF NOT EXISTS +
                   DO $$ EXCEPTION WHEN duplicate_object)
```

`provisionTenantSchema` la aplica automáticamente al crear cada tenant
nuevo. Ya marcada como aplicada en `tenant_template._prisma_migrations_tenant`.

**Por qué importaba**: el alta de "mobileshop" (12-may) se atascó con
`ColumnNotFound: empresaId` porque las lazy migrations sólo se aplicaban
en el primer request de cada tenant, pero el webhook
`checkout.session.completed` hacía el primer INSERT del OWNER user
*antes* del primer request. Detalle del incidente y rescate manual en
commits `d2d1759` (fix temporal: añadir `runMigrations()` dentro del
provisioning) y `b940025` (fix permanente: migración formal).

**Limpieza pendiente** (no urgente): los ~11 archivos que aún
`import { runMigrations } from "@/lib/migrate"` pueden simplificarse
(la función es no-op). No es regresión funcional dejarlos como están.

Test E2E: schema fresco aplicado las 8 migraciones formales en orden
produce 18 cols en `User` (incluyendo `empresaId`) + 51 tablas
(+ `_prisma_migrations_tenant` = 52, idéntico a template).

## 7.bis. Cutover wildcard `*.empleaia.es` (2026-05-12)

**Problema previo**: dar de alta un tenant requería crear manualmente
un Domain en Dokploy con su cert HTTP-01. Subdominios sin entrada
(p. ej. `pepe.empleaia.es`) devolvían 404 aunque el wildcard DNS en
IONOS resolvía la IP, porque Traefik no tenía router para ese host.

**Solución desplegada**: cert wildcard `*.empleaia.es` vía DNS-01
con IONOS + router `HostRegexp` catch-all en Traefik. A partir de ya
**cualquier slug nuevo funciona sin tocar Dokploy** — el subdominio
responde con cert válido en cuanto el tenant existe en `master.tenants`.

### Componentes añadidos

1. **API Key IONOS** (`Developer Portal`, nombre `empleaia`,
   prefijo `81ccb10895434e338bf530cad09b61fa`). Permisos: DNS
   read/write (heredados del usuario IONOS dueño de la zona). Vive
   solo en el VPS: `/etc/dokploy/ionos.env` (modo 600). Renovación:
   no caduca, Traefik renueva certs cada 60 días con la misma key.

2. **Resolver `ionos` en `/etc/dokploy/traefik/traefik.yml`**
   (convive con `letsencrypt` HTTP-01 existente):

   ```yaml
   certificatesResolvers:
     letsencrypt:   # se mantiene para routers Host() existentes
       acme:
         email: dansanch@agentesia.madrid
         storage: /etc/dokploy/traefik/dynamic/acme.json
         httpChallenge: { entryPoint: web }
     ionos:         # nuevo, DNS-01 para wildcard
       acme:
         email: dansanch@agentesia.madrid
         storage: /etc/dokploy/traefik/dynamic/acme-ionos.json
         dnsChallenge:
           provider: ionos
           resolvers: ["1.1.1.1:53", "8.8.8.8:53"]
           propagation:
             delayBeforeChecks: 30s
   ```

3. **Router catch-all en `/etc/dokploy/traefik/dynamic/empleaia-tenant-wildcard.yml`**:

   ```yaml
   http:
     routers:
       empleaia-tenant-catchall-https:
         rule: "HostRegexp(`^[a-z0-9-]+\\.empleaia\\.es$`)"
         service: empleaia-tenant-service
         entryPoints: [websecure]
         tls:
           certResolver: ionos
           domains: [{ main: empleaia.es, sans: ["*.empleaia.es"] }]
       empleaia-tenant-catchall-http:
         rule: "HostRegexp(`^[a-z0-9-]+\\.empleaia\\.es$`)"
         service: empleaia-tenant-service
         middlewares: [redirect-to-https]
         entryPoints: [web]
     services:
       empleaia-tenant-service:
         loadBalancer:
           servers: [{ url: "http://empleaia-empleaiaapp-apdwzc:3000" }]
           passHostHeader: true
   ```

4. **Contenedor `dokploy-traefik` recreado** con `--env-file
   /etc/dokploy/ionos.env`. Networks: `bridge` + `dokploy-network`.
   Ports 80, 443/tcp, 443/udp.

### Convivencia y prioridad

Traefik prioriza `Host()` exacto sobre `HostRegexp`, así que:
- `app.empleaia.es`, `admin.empleaia.es`, `tecnocloud.empleaia.es`,
  `manolo.empleaia.es`, `ucm.empleaia.es`, `dev.empleaia.es`, y el
  landing `empleaia.es` / `www.empleaia.es` → siguen con su cert
  HTTP-01 R12/R13 en `acme.json`. **No se han tocado.**
- Cualquier otro `<slug>.empleaia.es` → cae en el catch-all,
  cert wildcard de `acme-ionos.json` (SAN `DNS:*.empleaia.es`).

Limpieza opcional posterior (no urgente): borrar los Domains
individuales de `tecnocloud`, `manolo`, `ucm`, `dev` desde la UI
de Dokploy. Quedarían cubiertos por el wildcard. `app` y `admin`
**no** se deberían borrar — son entradas funcionales con cert
propio que NextAuth/Stripe usan como canónicas (NEXTAUTH_URL).

### Rollback

Si algo falla con el wildcard:

```bash
ssh -p 5251 root@185.47.13.172
rm /etc/dokploy/traefik/dynamic/empleaia-tenant-wildcard.yml
cp /etc/dokploy/traefik/backups/traefik.yml.20260512-155556 \
   /etc/dokploy/traefik/traefik.yml
docker restart dokploy-traefik
```

Vuelve al estado pre-cutover. El cert wildcard queda huérfano en
`acme-ionos.json` (no estorba). Los Domains individuales en Dokploy
seguían existiendo durante todo el cutover, así que no hay
regresión.

### Verificación rápida

```bash
# Subdominio cualquiera (tenant inexistente) → la app responde 404
# con cert válido del wildcard:
curl -kIs https://aleatorio.empleaia.es/ | head -3
openssl s_client -servername x.empleaia.es -connect empleaia.es:443 \
  </dev/null 2>/dev/null | openssl x509 -noout -text \
  | grep -A1 'Subject Alt'
# debe mostrar: DNS:*.empleaia.es, DNS:empleaia.es
```

## 8. Cómo retomar

1. `cd "/Users/dani/Claude Code/Proyectos Claude/fichaje"`.
2. `git status` — debería estar limpio en `feature/saas-migration`.
3. `git pull` por si hubo cambios externos.
4. Lee `AGENTS.md` (reglas estructurales) y este `docs/HANDOFF.md`.
5. Si vas a desplegar: `git push` → Dokploy auto-pull. Si el deploy
   falla, lo ves en la UI o con:
   ```
   docker exec dokploy-postgres.1.<id> psql -U dokploy -d dokploy \
     -c "SELECT \"createdAt\", status FROM deployment \
         WHERE \"applicationId\"='kbhSgmRPJZqRLvgD8g6ps' \
         ORDER BY \"createdAt\" DESC LIMIT 5;"
   ```
6. Para desarrollo local hay un seed: `NODE_ENV=development npm run dev:seed-tenant`
   crea `tenant_dev` con OWNER `admin@dev.local / dev_password_2026`.
   Después `npm run dev` y abre `http://dev.localhost:3000/login`.
