/**
 * provisionTenantDirect — alta de tenant SIN pasar por Stripe Checkout.
 *
 * Coreografía PENDING → PROVISIONING → ACTIVE de forma síncrona, sin
 * tarjeta. Espejo del webhook `handleCheckoutCompleted` pero:
 *  - no persiste subscription (no hay Stripe),
 *  - asigna features con `applyPlanFeatures(planKey)` en vez de
 *    `recomposeTenantFeatures(subscription)`.
 *
 * Cuando se reintegre Stripe (cambio de cuenta pendiente), la facturación
 * vuelve por el webhook; este camino queda como alta sin pago.
 *
 * Idempotente: el claim `pending → provisioning` con WHERE filtra
 * reentradas; `provisionTenantSchema` y `createOwnerAndSeed` son
 * idempotentes de por sí.
 */

import { prismaMaster, invalidateTenantClient } from "@/lib/prisma";
import { provisionTenantSchema } from "@/lib/tenant/provision";
import {
  createOwnerAndSeed,
  sendWelcomeEmail,
  type TenantOwnerInput,
} from "@/lib/tenant/owner-setup";
import { applyPlanFeatures } from "@/lib/stripe/feature-resolver";

export async function provisionTenantDirect(
  tenant: TenantOwnerInput,
  planKey: string,
): Promise<void> {
  // 1. PENDING → PROVISIONING (atomic). Si otra ejecución ya lo cogió,
  //    salimos: el tenant ya está siendo provisionado o lo está.
  const claimed = await prismaMaster.tenant.updateMany({
    where: { id: tenant.id, status: "pending" },
    data: { status: "provisioning", updatedAt: new Date() },
  });
  if (claimed.count === 0) return;

  // 2. Features por plan (sin subscription Stripe).
  await applyPlanFeatures(tenant.id, planKey);

  // 3. Provisionar el schema del tenant (CREATE SCHEMA + migraciones).
  await provisionTenantSchema(tenant.slug);

  // 4. Invalidar cliente Prisma cacheado para este slug.
  invalidateTenantClient(tenant.slug);

  // 5. Crear primer OWNER (sin password, resetToken) + seed config.
  const resetToken = await createOwnerAndSeed(tenant);

  // 6. PROVISIONING → ACTIVE.
  await prismaMaster.tenant.updateMany({
    where: { id: tenant.id, status: "provisioning" },
    data: { status: "active" },
  });

  // 7. Email de bienvenida con enlace set-password (no lanza si falla).
  await sendWelcomeEmail(tenant, resetToken);
}
