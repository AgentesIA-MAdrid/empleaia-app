/**
 * Catálogo de acciones auditables. ADR-007 §2.7.
 *
 * Lista cerrada — añadir entradas requiere PR explícito. Cada acción
 * tiene una severity fija (no se decide en runtime).
 *
 * Convenciones de target_kind: 'tenant' | 'feature' | 'subscription'
 * | 'user' | 'session' | 'audit_log' (lecturas) | 'metrics'.
 */

export type AuditSeverity = "info" | "warning" | "critical";

export type AuditActionDef = {
  severity: AuditSeverity;
  description: string;
};

export const AUDIT_ACTIONS = {
  // Lecturas (severity='info').
  "tenants:list": { severity: "info", description: "Listado de tenants" },
  "tenants:read": { severity: "info", description: "Detalle de tenant" },
  "audit-log:list": { severity: "info", description: "Listado de audit log" },
  "metrics:read": { severity: "info", description: "Lectura de métricas globales" },

  // Mutaciones reversibles (severity='warning').
  "tenant_features:override": {
    severity: "warning",
    description: "Override manual de feature",
  },
  "tenant_features:override:remove": {
    severity: "warning",
    description: "Eliminar override manual",
  },
  "tenants:suspend": {
    severity: "warning",
    description: "active → suspended",
  },
  "tenants:restore": {
    severity: "warning",
    description: "suspended → active",
  },
  "tenants:provision": {
    severity: "warning",
    description: "Provisión manual (sin Stripe)",
  },
  "subscription:extend": {
    severity: "warning",
    description: "Extender periodo de suscripción a mano",
  },

  // Irreversibles (severity='critical').
  "subscription:cancel": {
    severity: "critical",
    description: "Cancelar suscripción (solo BD local)",
  },
  "tenants:purge:pseudonymize": {
    severity: "critical",
    description: "Pseudonimización ADR-008",
  },
  "tenants:purge:hard-delete": {
    severity: "critical",
    description: "Hard delete ADR-008",
  },

  // Auth eventos super-admin.
  "super-admin:login": { severity: "info", description: "Login super-admin" },
  "super-admin:login-failed": {
    severity: "warning",
    description: "Login fallido",
  },
  "super-admin:logout": { severity: "info", description: "Logout super-admin" },
} as const satisfies Record<string, AuditActionDef>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export function severityOf(action: AuditAction): AuditSeverity {
  return AUDIT_ACTIONS[action].severity;
}
