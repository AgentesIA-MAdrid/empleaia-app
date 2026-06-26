import { checkRate } from "@/lib/rate-limit";

const MAX_PER_TENANT_PER_DAY = 10;
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Límite de tickets por tenant/día (anti-spam del widget de feedback). */
export function checkFeedbackRateLimit(tenantId: string): { allowed: boolean } {
  const { ok } = checkRate(`feedback:tenant:${tenantId}`, MAX_PER_TENANT_PER_DAY, WINDOW_MS);
  return { allowed: ok };
}
