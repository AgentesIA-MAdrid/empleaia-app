/**
 * Server action del formulario /registro. ADR-003 §2.6 + Enmienda 1
 * del plan de Fase 4 (server actions del subdominio app usan
 * prismaMaster, NO prismaApp).
 */

"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prismaMaster } from "@/lib/prisma";
import { stripe } from "@/lib/stripe/client";
import { getPlanPriceId } from "@/lib/stripe/price-catalog";
import { calculateQuantity } from "@/lib/billing/checkout";
import { registroSchema, suggestSlugAlternatives } from "@/lib/registro/schema";

/**
 * Resuelve la URL base pública del subdominio app a partir del request.
 * Prioridad:
 *   1. STRIPE_CHECKOUT_BASE_URL (env override).
 *   2. NEXTAUTH_URL (canonical de la app).
 *   3. host del request (con `https` por defecto si TENANT_ROOT_DOMAIN
 *      no es localhost).
 *
 * Garantiza que en producción NO se filtre `localhost` ni `app.localhost`.
 */
async function resolveCheckoutBaseUrl(): Promise<string> {
  const override = process.env.STRIPE_CHECKOUT_BASE_URL;
  if (override) return override.replace(/\/$/, "");

  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (nextAuthUrl) return nextAuthUrl.replace(/\/$/, "");

  const h = await headers();
  const host = h.get("host") ?? "app.empleaia.es";
  const proto = host.includes("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

export type RegistroResult =
  | { kind: "ok"; redirectUrl: string } // server action redirige; este caso no se devuelve normalmente
  | { kind: "error"; message: string; field?: string; suggestions?: string[] };

export async function registrarTenantAction(
  prevState: unknown,
  formData: FormData,
): Promise<RegistroResult> {
  // 1. Parse + validar.
  const raw = {
    nombre: formData.get("nombre"),
    email: formData.get("email"),
    slug: formData.get("slug"),
    planKey: formData.get("planKey"),
    billingPeriod: formData.get("billingPeriod"),
  };
  const parsed = registroSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      kind: "error",
      message: first?.message ?? "Datos inválidos",
      field: first?.path.join(".") ?? undefined,
    };
  }
  const data = parsed.data;

  // 2. Slug en reserved_slugs.
  const reserved = await prismaMaster.reservedSlug.findUnique({
    where: { slug: data.slug },
  });
  if (reserved) {
    return {
      kind: "error",
      message: `El subdominio "${data.slug}" no está disponible.`,
      field: "slug",
      suggestions: suggestSlugAlternatives(data.slug),
    };
  }

  // 3. Resolver Stripe price.
  const priceId = getPlanPriceId(data.planKey, data.billingPeriod);
  if (!priceId) {
    return {
      kind: "error",
      message: `Plan ${data.planKey} ${data.billingPeriod} no configurado en Stripe. Contacta soporte.`,
    };
  }

  // 4. INSERT master.tenants con prismaMaster (Enmienda 1 del plan).
  let tenant;
  try {
    tenant = await prismaMaster.tenant.create({
      data: {
        slug: data.slug,
        name: data.nombre,
        email: data.email,
        status: "pending",
      },
    });
  } catch (err) {
    // P2002 = unique constraint violation.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return {
        kind: "error",
        message: `El subdominio "${data.slug}" acaba de ocuparse.`,
        field: "slug",
        suggestions: suggestSlugAlternatives(data.slug),
      };
    }
    throw err;
  }

  // 5. Crear Checkout Session.
  // En el registro inicial el tenant no tiene empleados todavía, así que
  // partimos de 0 y `calculateQuantity` devuelve el suelo del plan
  // (MIN_BILLABLE_SEATS = 15 usuarios, igual en todos los planes). El
  // cliente verá en factura ese mínimo independientemente de cuánta gente
  // cargue después, hasta que supere el suelo y empiece a facturarse el
  // variable real.
  const trialDays = parseInt(process.env.STRIPE_TRIAL_DAYS ?? "14", 10);
  const requiresCard =
    (process.env.STRIPE_TRIAL_REQUIRES_CARD ?? "true") === "true";
  const initialQuantity = calculateQuantity(0, data.planKey);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: initialQuantity }],
    client_reference_id: tenant.id,
    metadata: { tenant_id: tenant.id, tenant_slug: tenant.slug },
    subscription_data: {
      metadata: { tenant_id: tenant.id, tenant_slug: tenant.slug },
      ...(requiresCard && trialDays > 0
        ? { trial_period_days: trialDays }
        : {}),
    },
    // customer_creation NO aplica en mode=subscription — Stripe crea el
    // Customer automáticamente al completar el checkout. En su día se
    // incluyó copiando del plan §2.1; rompía la API real con
    // "customer_creation can only be used in payment mode" (verificado
    // en E2E real Fase 4).
    customer_email: data.email,
    success_url:
      process.env.STRIPE_CHECKOUT_SUCCESS_URL ??
      `${await resolveCheckoutBaseUrl()}/registro/exito?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:
      process.env.STRIPE_CHECKOUT_CANCEL_URL ??
      `${await resolveCheckoutBaseUrl()}/registro/cancelado`,
  });

  if (!session.url) {
    return {
      kind: "error",
      message: "Stripe no devolvió URL de checkout.",
    };
  }

  // 6. Redirect a Stripe Checkout.
  redirect(session.url);
}
