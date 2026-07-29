/**
 * Seed del control plane (schema master).
 *
 * Idempotente: cada upsert por `key`/`slug`. Re-ejecutable sin duplicar.
 *
 * Catálogo Fase 8 (estructura definitiva 3 planes empleaIA):
 *   - 3 planes (starter, pro, enterprise) con tagline + sortOrder.
 *   - 36 features (4 limits + 28 booleans + 4 quotas).
 *   - 105 plan_features (3 × 35) con valores explícitos por plan.
 *   - 45 reserved_slugs.
 *
 * Precios y posicionamiento UI: ver src/lib/billing/plan-pricing.ts.
 *
 * super_admins: tabla queda vacía. Se crea con `npm run super-admin:create`.
 */

import { PrismaClient } from "../../src/generated/prisma/client";

type FeatureType = "boolean" | "limit" | "quota";

type FeatureDef = {
  key: string;
  name: string;
  type: FeatureType;
  quotaPeriod?: "mes" | "dia";
  description?: string;
};

const PLANS = [
  {
    key: "starter",
    name: "Plan Starter",
    description: "Para equipos pequeños — hasta 10 empleados, 1 sede.",
    sortOrder: 10,
  },
  {
    key: "pro",
    name: "Plan Pro",
    description: "Para empresas en crecimiento — multi-sede, turnos, geofencing.",
    sortOrder: 20,
  },
  {
    key: "enterprise",
    name: "Plan Enterprise",
    description: "Para empresas grandes — branding, dominio propio, API, SSO, SLA.",
    sortOrder: 30,
  },
] as const;

const FEATURES: FeatureDef[] = [
  // ─── Limits (4) ────────────────────────────────────────────────────────────
  { key: "max_employees", name: "Máximo de empleados activos", type: "limit" },
  { key: "max_tiendas", name: "Máximo de sedes activas", type: "limit" },
  { key: "historial_meses", name: "Meses de histórico accesibles", type: "limit" },
  { key: "max_storage_mb", name: "Almacenamiento (MB)", type: "limit" },

  // ─── Booleans — fichaje (3) ────────────────────────────────────────────────
  { key: "web_clock_in", name: "Fichaje desde web", type: "boolean" },
  { key: "fichaje_movil", name: "Fichaje desde móvil/PWA", type: "boolean" },
  { key: "fichaje_tablet", name: "Fichaje desde tablet compartida", type: "boolean" },

  // ─── Booleans — funcionalidad (12) ─────────────────────────────────────────
  { key: "multi_tienda", name: "Multi-sede (>1 ubicación)", type: "boolean" },
  { key: "multi_empresa", name: "Multi-empresa (>1 CIF en una cuenta)", type: "boolean" },
  { key: "geofencing", name: "Geofencing por GPS", type: "boolean" },
  { key: "geo_clock_in", name: "Geolocalización en cada fichaje", type: "boolean" },
  { key: "bolsa_horas", name: "Bolsa de horas", type: "boolean" },
  { key: "turnos_publicacion", name: "Planificación y publicación de turnos", type: "boolean" },
  { key: "ausencias_aprobacion", name: "Flujo de aprobación de ausencias", type: "boolean" },
  { key: "onboarding_offboarding", name: "Onboarding y offboarding", type: "boolean" },
  { key: "comunicados", name: "Comunicados internos", type: "boolean" },
  { key: "articulos", name: "Base de conocimiento", type: "boolean" },
  { key: "documentos", name: "Gestión documental por empleado", type: "boolean" },
  { key: "notificaciones_email", name: "Notificaciones por email", type: "boolean" },
  { key: "notificaciones_push", name: "Notificaciones push", type: "boolean" },

  // ─── Booleans — gestión de personas (existentes en código, ahora con flag) ─
  { key: "tareas", name: "Gestor de tareas y proyectos", type: "boolean" },
  { key: "organigrama", name: "Organigrama interactivo", type: "boolean" },
  { key: "reclutamiento", name: "Módulo de reclutamiento (ATS)", type: "boolean" },
  { key: "evaluaciones", name: "Evaluaciones del desempeño", type: "boolean" },
  { key: "encuestas_clima", name: "Encuestas de clima laboral", type: "boolean" },
  { key: "objetivos", name: "Gestión de objetivos (OKRs)", type: "boolean" },
  { key: "formacion", name: "Plataforma de formación (LMS)", type: "boolean" },
  { key: "informes_avanzados", name: "Informes y estadísticas avanzados", type: "boolean" },
  // Cierre de turno: registro diario de ventas, cierre de caja, arqueos
  // semanales, objetivos de venta y conciliación con el banco. Una sola
  // llave para el módulo entero: las cinco áreas se activan juntas.
  { key: "cierre_turno", name: "Cierre de turno, arqueos y conciliación", type: "boolean" },

  // ─── Booleans — finanzas (existentes en código, ahora con flag) ────────────
  { key: "prenomina", name: "Preparación de nóminas (prenómina)", type: "boolean" },
  { key: "envio_nominas", name: "Envío de nóminas a empleados", type: "boolean" },
  { key: "control_gastos", name: "Control y gestión de gastos", type: "boolean" },
  { key: "retribucion_flex", name: "Retribución flexible", type: "boolean" },

  // ─── Booleans — features nuevas (alineamiento con Sesame) ──────────────────
  { key: "canal_denuncias", name: "Canal de denuncias (Ley 2/2023)", type: "boolean" },
  { key: "asistente_ia", name: "Asistente IA (empleaIA AI)", type: "boolean" },
  { key: "chat", name: "Chat interno", type: "boolean" },
  { key: "face_id", name: "Fichaje con reconocimiento facial (Face ID)", type: "boolean" },
  { key: "marketplace", name: "Marketplace de integraciones", type: "boolean" },
  { key: "custom_requests", name: "Formularios y peticiones personalizadas", type: "boolean" },
  { key: "reserva_espacios", name: "Reserva de espacios y mesas", type: "boolean" },
  { key: "whatsapp_bot", name: "Asistente y notificaciones por WhatsApp", type: "boolean" },

  // ─── Booleans — exportación e integración (8) ──────────────────────────────
  { key: "export_csv", name: "Exportar a CSV", type: "boolean" },
  { key: "export_excel", name: "Exportar a Excel (XLSX)", type: "boolean" },
  { key: "export_pdf", name: "Exportar a PDF", type: "boolean" },
  { key: "api_access", name: "API REST pública", type: "boolean" },
  { key: "webhooks", name: "Webhooks salientes", type: "boolean" },
  { key: "sso_saml", name: "SSO / SAML", type: "boolean" },
  { key: "integraciones_nomina", name: "Integraciones con software de nómina", type: "boolean" },
  { key: "firma_electronica", name: "Firma electrónica de documentos", type: "boolean" },

  // ─── Booleans — branding y operaciones (4) ─────────────────────────────────
  { key: "branding_personalizado", name: "Branding personalizado", type: "boolean" },
  { key: "dominio_personalizado", name: "Dominio personalizado (CNAME)", type: "boolean" },
  { key: "auditoria_avanzada", name: "Auditoría avanzada", type: "boolean" },
  { key: "people_analytics", name: "People Analytics", type: "boolean" },

  // ─── Quotas (4) ────────────────────────────────────────────────────────────
  { key: "emails_mes", name: "Emails enviables por mes", type: "quota", quotaPeriod: "mes" },
  { key: "pushs_mes", name: "Notificaciones push por mes", type: "quota", quotaPeriod: "mes" },
  { key: "exports_mes", name: "Exportaciones por mes", type: "quota", quotaPeriod: "mes" },
  { key: "api_calls_dia", name: "Llamadas API por día", type: "quota", quotaPeriod: "dia" },
];

// Estructura definitiva alineada con Sesame (mínimo 15 usuarios global):
//   STARTER  Time + base HR + nóminas + IA básica · 4 €/usuario · mín 60 €/mes
//   PRO      Todo + cultura + reclutamiento avanzado · 5 €/usuario · mín 75 €/mes
//   ENTERPR. Todo + branding + API + IA premium · 6 €/usuario · mín 90 €/mes
type PlanFeatureValue = boolean | number | null;

const PLAN_FEATURE_VALUES: Record<string, Record<string, PlanFeatureValue>> = {
  starter: {
    // Limits
    max_employees: null,
    max_tiendas: null,
    historial_meses: 12,
    max_storage_mb: 4000,
    // Fichaje
    web_clock_in: true,
    fichaje_movil: true,
    fichaje_tablet: true,
    face_id: true,
    // Funcionalidad
    multi_tienda: true,
    multi_empresa: true,
    geofencing: false,
    geo_clock_in: false,
    bolsa_horas: true,
    turnos_publicacion: true,
    ausencias_aprobacion: true,
    onboarding_offboarding: false,
    comunicados: true,
    articulos: true,
    documentos: true,
    notificaciones_email: true,
    notificaciones_push: false,
    // Gestión de personas
    tareas: true,
    organigrama: true,
    reclutamiento: true, // 5 ofertas activas (limitado vía quota)
    evaluaciones: false,
    encuestas_clima: false,
    objetivos: false,
    formacion: true,
    informes_avanzados: true,
    cierre_turno: false,
    // Finanzas
    prenomina: true,
    envio_nominas: true,
    control_gastos: false,
    retribucion_flex: false,
    // Sesame parity
    canal_denuncias: true,
    asistente_ia: false,
    chat: false,
    marketplace: true,
    custom_requests: false,
    reserva_espacios: false,
    whatsapp_bot: false,
    // Exportación e integración
    export_csv: true,
    export_excel: true,
    export_pdf: true,
    api_access: false,
    webhooks: false,
    sso_saml: false,
    integraciones_nomina: true,
    firma_electronica: true, // 3/año (limitado vía quota)
    // Branding y operaciones
    branding_personalizado: false,
    dominio_personalizado: false,
    auditoria_avanzada: false,
    people_analytics: false,
    // Quotas
    emails_mes: 1000,
    pushs_mes: 0,
    exports_mes: 20,
    api_calls_dia: 0,
  },
  pro: {
    // Limits
    max_employees: null,
    max_tiendas: null,
    historial_meses: 36,
    max_storage_mb: 6000,
    // Fichaje
    web_clock_in: true,
    fichaje_movil: true,
    fichaje_tablet: true,
    face_id: true,
    // Funcionalidad
    multi_tienda: true,
    multi_empresa: true,
    geofencing: true,
    geo_clock_in: true,
    bolsa_horas: true,
    turnos_publicacion: true,
    ausencias_aprobacion: true,
    onboarding_offboarding: true,
    comunicados: true,
    articulos: true,
    documentos: true,
    notificaciones_email: true,
    notificaciones_push: true,
    // Gestión de personas
    tareas: true,
    organigrama: true,
    reclutamiento: true, // 25 ofertas activas
    evaluaciones: true,
    encuestas_clima: true,
    objetivos: true,
    formacion: true,
    informes_avanzados: true,
    cierre_turno: false,
    // Finanzas
    prenomina: true,
    envio_nominas: true,
    control_gastos: true,
    retribucion_flex: true,
    // Sesame parity
    canal_denuncias: true,
    asistente_ia: false,
    chat: true,
    marketplace: true,
    custom_requests: true,
    reserva_espacios: true,
    whatsapp_bot: false,
    // Exportación e integración
    export_csv: true,
    export_excel: true,
    export_pdf: true,
    api_access: false,
    webhooks: false,
    sso_saml: false,
    integraciones_nomina: true,
    firma_electronica: true, // 4/año
    // Branding y operaciones
    branding_personalizado: false,
    dominio_personalizado: false,
    auditoria_avanzada: true,
    people_analytics: true,
    // Quotas
    emails_mes: 10000,
    pushs_mes: null,
    exports_mes: 200,
    api_calls_dia: 0,
  },
  enterprise: {
    // Limits
    max_employees: null,
    max_tiendas: null,
    historial_meses: 120,
    max_storage_mb: 10000,
    // Fichaje
    web_clock_in: true,
    fichaje_movil: true,
    fichaje_tablet: true,
    face_id: true,
    // Funcionalidad
    multi_tienda: true,
    multi_empresa: true,
    geofencing: true,
    geo_clock_in: true,
    bolsa_horas: true,
    turnos_publicacion: true,
    ausencias_aprobacion: true,
    onboarding_offboarding: true,
    comunicados: true,
    articulos: true,
    documentos: true,
    notificaciones_email: true,
    notificaciones_push: true,
    // Gestión de personas
    tareas: true,
    organigrama: true,
    reclutamiento: true, // ofertas ilimitadas
    evaluaciones: true,
    encuestas_clima: true,
    objetivos: true,
    formacion: true,
    informes_avanzados: true,
    cierre_turno: true,
    // Finanzas
    prenomina: true,
    envio_nominas: true,
    control_gastos: true,
    retribucion_flex: true,
    // Sesame parity
    canal_denuncias: true,
    asistente_ia: true,
    chat: true,
    marketplace: true,
    custom_requests: true,
    reserva_espacios: true,
    whatsapp_bot: true,
    // Exportación e integración
    export_csv: true,
    export_excel: true,
    export_pdf: true,
    api_access: true,
    webhooks: true,
    sso_saml: true,
    integraciones_nomina: true,
    firma_electronica: true, // ilimitada
    // Branding y operaciones
    branding_personalizado: true,
    dominio_personalizado: true,
    auditoria_avanzada: true,
    people_analytics: true,
    // Quotas
    emails_mes: null,
    pushs_mes: null,
    exports_mes: null,
    api_calls_dia: 10000,
  },
};

const RESERVED_SLUGS: Array<{ slug: string; reason: string }> = [
  { slug: "admin", reason: "subdominio del panel super-admin" },
  { slug: "app", reason: "subdominio público (landing, registro, checkout)" },
  { slug: "www", reason: "alias clásico del apex" },
  { slug: "api", reason: "reservado para API pública futura" },
  { slug: "status", reason: "reservado para status page" },
  { slug: "docs", reason: "reservado para documentación" },
  { slug: "mail", reason: "subdominio técnico de correo" },
  { slug: "blog", reason: "reservado para blog" },
  { slug: "ftp", reason: "subdominio técnico FTP" },
  { slug: "smtp", reason: "subdominio técnico SMTP" },
  { slug: "ns", reason: "subdominio reservado DNS" },
  { slug: "ns1", reason: "subdominio reservado DNS" },
  { slug: "ns2", reason: "subdominio reservado DNS" },
  { slug: "root", reason: "reservado por convención" },
  { slug: "support", reason: "reservado para soporte" },
  { slug: "help", reason: "reservado para ayuda" },
  { slug: "login", reason: "reservado para flujo de login global" },
  { slug: "signup", reason: "reservado para registro" },
  { slug: "register", reason: "reservado para registro" },
  { slug: "billing", reason: "reservado para facturación" },
  { slug: "security", reason: "reservado para seguridad/contacto" },
  { slug: "abuse", reason: "reservado por estándar (abuse@dominio)" },
  { slug: "webmaster", reason: "reservado por estándar" },
  { slug: "postmaster", reason: "reservado por estándar" },
  { slug: "hostmaster", reason: "reservado por estándar" },
  { slug: "hostinfo", reason: "reservado por estándar" },
  { slug: "no-reply", reason: "reservado por convención email" },
  { slug: "noreply", reason: "reservado por convención email" },
  { slug: "info", reason: "reservado para información de contacto" },
  { slug: "contact", reason: "reservado para contacto" },
  { slug: "sales", reason: "reservado para ventas" },
  { slug: "legal", reason: "reservado para legal" },
  { slug: "privacy", reason: "reservado para política de privacidad" },
  { slug: "terms", reason: "reservado para términos de servicio" },
  { slug: "dashboard", reason: "reservado por convención" },
  { slug: "panel", reason: "reservado por convención" },
  { slug: "control", reason: "reservado por convención" },
  { slug: "master", reason: "reservado para evitar confusión con el control plane" },
  { slug: "public", reason: "reservado para evitar confusión con el schema public" },
  { slug: "test", reason: "reservado para entornos de test" },
  { slug: "staging", reason: "reservado para entorno de staging" },
  { slug: "prod", reason: "reservado para entorno de producción" },
  { slug: "production", reason: "reservado para entorno de producción" },
  { slug: "demo", reason: "reservado para entornos de demostración" },
];

export async function seedMaster(prisma: PrismaClient): Promise<void> {
  // 1. Plans (3 upserts).
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { key: plan.key },
      create: { key: plan.key, name: plan.name, description: plan.description, sortOrder: plan.sortOrder },
      update: { name: plan.name, description: plan.description, sortOrder: plan.sortOrder },
    });
  }

  // 2. Features (35 upserts).
  for (const f of FEATURES) {
    await prisma.feature.upsert({
      where: { key: f.key },
      create: {
        key: f.key,
        name: f.name,
        type: f.type,
        quotaPeriod: f.quotaPeriod ?? null,
        description: f.description ?? null,
      },
      update: {
        name: f.name,
        type: f.type,
        quotaPeriod: f.quotaPeriod ?? null,
        description: f.description ?? null,
      },
    });
  }

  // 3. PlanFeatures (108 upserts: 3 planes × 36 features).
  for (const [planKey, featureValues] of Object.entries(PLAN_FEATURE_VALUES)) {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: planKey } });
    for (const [featureKey, value] of Object.entries(featureValues)) {
      await prisma.planFeature.upsert({
        where: { planId_featureKey: { planId: plan.id, featureKey } },
        create: { planId: plan.id, featureKey, value: value as never },
        update: { value: value as never },
      });
    }
  }

  // 4. ReservedSlugs (45 upserts).
  for (const r of RESERVED_SLUGS) {
    await prisma.reservedSlug.upsert({
      where: { slug: r.slug },
      create: { slug: r.slug, reason: r.reason },
      update: { reason: r.reason },
    });
  }

  // Verificación visual.
  const counts = {
    plans: await prisma.plan.count(),
    features: await prisma.feature.count(),
    planFeatures: await prisma.planFeature.count(),
    reservedSlugs: await prisma.reservedSlug.count(),
  };
  console.log("[seed master]", counts);
}
