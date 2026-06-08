/**
 * handleCheckoutCompleted — coreografía PENDING → PROVISIONING → ACTIVE.
 * ADR-003 §2.6.
 *
 * Disparado por Stripe `checkout.session.completed` tras un registro en
 * `/registro` con redirect a Stripe Checkout (commit 14-16). Pasos:
 *
 *  1. Lookup tenant por session.client_reference_id.
 *  2. Status guards:
 *     - active|suspended → 200 silencioso (replay tras provisión OK).
 *     - provisioning → 200 silencioso (otra ejecución en curso).
 *     - pending → procede.
 *  3. UPDATE pending → provisioning (atomic).
 *  4. UPDATE stripe_customer_id.
 *  5. Recuperar subscription completa con expand=items.data.price.
 *  6. persistSubscription (subscriptions + items).
 *  7. recomposeTenantFeatures (plan + addons; preserva manual_override).
 *  8. provisionTenantSchema (CREATE SCHEMA + GRANTs + migraciones).
 *  9. Invalidar cliente Prisma cacheado para el slug (Enmienda 2).
 * 10. Crear primer OWNER en runWithTenant (sin password; resetToken).
 * 11. UPDATE provisioning → active.
 * 12. Email de bienvenida con link de set-password.
 *
 * Idempotencia: cada UPDATE con WHERE status=... filtra retries.
 * El INSERT inicial en stripe_events (idempotency.ts) es la primera
 * barrera; estos UPDATE condicionales son la segunda.
 */

import type Stripe from "stripe";
import { prismaMaster, invalidateTenantClient } from "@/lib/prisma";
import { stripe } from "../client";
import { provisionTenantSchema } from "@/lib/tenant/provision";
import { createOwnerAndSeed, sendWelcomeEmail } from "@/lib/tenant/owner-setup";
import {
  persistSubscription,
  recomposeTenantFeatures,
} from "../feature-resolver";

export async function handleCheckoutCompleted(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const tenantId = session.client_reference_id;
  if (!tenantId) {
    throw new Error(
      "client_reference_id ausente en checkout.session.completed",
    );
  }

  // 1. Lookup tenant.
  const tenant = await prismaMaster.tenant.findUnique({
    where: { id: tenantId },
  });
  if (!tenant) {
    // §8.4 del plan: firma OK pero tenant desconocido. Log + 200
    // (no es bug nuestro, es webhook desviado de otra cuenta Stripe).
    console.warn(
      `[stripe] tenant ${tenantId} no existe en master.tenants; ignorando`,
    );
    return;
  }

  // 2. Status guards.
  if (tenant.status === "active" || tenant.status === "suspended") return;
  if (tenant.status === "provisioning") return;

  // 3. PENDING → PROVISIONING (atomic).
  const claimed = await prismaMaster.tenant.updateMany({
    where: { id: tenantId, status: "pending" },
    data: { status: "provisioning", updatedAt: new Date() },
  });
  if (claimed.count === 0) return; // otra ejecución la cogió

  // 4. Persistir Stripe Customer.
  const stripeCustomerId = session.customer as string;
  await prismaMaster.tenant.update({
    where: { id: tenantId },
    data: { stripeCustomerId },
  });

  // 5. Recuperar subscription completa.
  if (!session.subscription) {
    throw new Error("session.subscription ausente");
  }
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });

  // 6. Persist subscription + items.
  await persistSubscription(tenantId, subscription);

  // 7. Recompose tenant_features.
  await recomposeTenantFeatures(tenantId, subscription);

  // 8. Provisionar el schema del tenant.
  await provisionTenantSchema(tenant.slug);

  // 9. Invalidar cualquier cliente Prisma cacheado para este slug
  //    (Enmienda 2 del plan de Fase 4).
  invalidateTenantClient(tenant.slug);

  // 10. Crear primer OWNER en el schema del tenant (sin password,
  //     resetToken) + seed ConfiguracionEmpresa.
  const resetToken = await createOwnerAndSeed(tenant);

  // 11. PROVISIONING → ACTIVE.
  await prismaMaster.tenant.updateMany({
    where: { id: tenantId, status: "provisioning" },
    data: { status: "active" },
  });

  // 12. Email de bienvenida con enlace set-password.
  await sendWelcomeEmail(tenant, resetToken);
}
