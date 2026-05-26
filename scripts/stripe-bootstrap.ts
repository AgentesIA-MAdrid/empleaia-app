#!/usr/bin/env node
/**
 * stripe:bootstrap — crea/actualiza productos + prices en Stripe.
 * Idempotente: usa metadata.fichaje_key como identificador estable; si
 * el product ya existe con esa key, lo reutiliza.
 *
 * Catálogo:
 *   3 productos (starter, pro, enterprise) × 2 prices (monthly, yearly)
 *   = 6 prices de planes.
 *   7 productos addon × 1 price (monthly) = 7 prices de addons.
 *   Total: 10 productos + 13 prices.
 *
 * Modelo de planes — pricing per-seat (billing_scheme=per_unit). Los
 * importes de plan se DERIVAN de `plan-pricing.ts` (fuente de verdad)
 * para no desincronizarse del backend (`calculateQuantity`):
 *   starter:    4 €/empleado/mes  (PLAN_PRICING.starter.pricePerEmployeeCents)
 *   pro:        5 €/empleado/mes
 *   enterprise: 6 €/empleado/mes
 * El `unit_amount` del price es el precio POR EMPLEADO; el mínimo de
 * `MIN_BILLABLE_SEATS` (15) usuarios lo impone el backend al calcular
 * la `quantity` del line_item, no Stripe. El yearly aplica 10 meses
 * (descuento implícito de 2 meses).
 *
 * Al finalizar, emite a stdout las env vars STRIPE_PRICE_* listas para
 * copiar al entorno (Dokploy / .env).
 *
 * Uso (TEST):
 *   STRIPE_SECRET_KEY=sk_test_... npm run stripe:bootstrap
 *
 * Uso (LIVE — productos REALES en la cuenta de cobro):
 *   STRIPE_SECRET_KEY=sk_live_... STRIPE_BOOTSTRAP_ALLOW_LIVE=1 npm run stripe:bootstrap
 *
 * Por seguridad, con una key `sk_live_` el script ABORTA salvo que se
 * pase explícitamente STRIPE_BOOTSTRAP_ALLOW_LIVE=1 (confirmación
 * deliberada de que se quiere tocar la cuenta real).
 */

import "dotenv/config";
import { stripe } from "../src/lib/stripe/client";
import {
  PLAN_PRICING,
  PLAN_ORDER,
  MIN_BILLABLE_SEATS,
} from "../src/lib/billing/plan-pricing";
import type Stripe from "stripe";

type ProductDef = {
  fichajeKey: string;
  name: string;
  description: string;
  prices: { lookupKey: string; amountCents: number; interval: "month" | "year" }[];
};

/** Meses facturados en el price anual (2 de descuento sobre 12). */
const YEARLY_MONTHS = 10;

// Planes — derivados de PLAN_PRICING para que el `unit_amount` (precio
// por empleado/mes) sea SIEMPRE el mismo que usa el backend. El mínimo
// monetario por plan (15 × precio) se muestra en la descripción a modo
// informativo; lo aplica `calculateQuantity`, no este price.
const PLAN_PRODUCTS: ProductDef[] = PLAN_ORDER.map((key) => {
  const p = PLAN_PRICING[key];
  const perEmp = (p.pricePerEmployeeCents / 100).toLocaleString("es-ES");
  const min = (p.monthlyMinimumCents / 100).toLocaleString("es-ES");
  return {
    fichajeKey: `plan_${key}`,
    name: `Plan ${p.displayName}`,
    description: `${p.tagline} — ${perEmp} €/empleado/mes (mín. ${min} €/mes, ${MIN_BILLABLE_SEATS} usuarios).`,
    prices: [
      {
        lookupKey: `plan_${key}_monthly`,
        amountCents: p.pricePerEmployeeCents,
        interval: "month",
      },
      {
        lookupKey: `plan_${key}_yearly`,
        amountCents: p.pricePerEmployeeCents * YEARLY_MONTHS,
        interval: "year",
      },
    ],
  };
});

const ADDON_PRODUCTS: ProductDef[] = [
  {
    fichajeKey: "addon_dominio_personalizado",
    name: "Addon — Dominio personalizado",
    description: "Subdominio propio para el tenant.",
    prices: [{ lookupKey: "addon_dominio_personalizado", amountCents: 1500, interval: "month" }],
  },
  {
    fichajeKey: "addon_api_access",
    name: "Addon — Acceso API",
    description: "API REST con tokens y rate limit.",
    prices: [{ lookupKey: "addon_api_access", amountCents: 2900, interval: "month" }],
  },
  {
    fichajeKey: "addon_integraciones_nomina",
    name: "Addon — Integraciones nómina",
    description: "Conexión con A3, Sage, Holded.",
    prices: [{ lookupKey: "addon_integraciones_nomina", amountCents: 3900, interval: "month" }],
  },
  {
    fichajeKey: "addon_firma_electronica",
    name: "Addon — Firma electrónica",
    description: "Firma digital de documentos del empleado.",
    prices: [{ lookupKey: "addon_firma_electronica", amountCents: 1900, interval: "month" }],
  },
  {
    fichajeKey: "addon_people_analytics",
    name: "Addon — People analytics",
    description: "Dashboard avanzado de RRHH.",
    prices: [{ lookupKey: "addon_people_analytics", amountCents: 2900, interval: "month" }],
  },
  {
    fichajeKey: "addon_storage_extra",
    name: "Addon — Storage extra (10 GB)",
    description: "10 GB adicionales para documentos y fotos.",
    prices: [{ lookupKey: "addon_storage_extra", amountCents: 900, interval: "month" }],
  },
  {
    fichajeKey: "addon_emails_extra",
    name: "Addon — Emails extra (10k/mes)",
    description: "10.000 emails adicionales al mes.",
    prices: [{ lookupKey: "addon_emails_extra", amountCents: 900, interval: "month" }],
  },
];

const PRODUCTS: ProductDef[] = [...PLAN_PRODUCTS, ...ADDON_PRODUCTS];

async function upsertProduct(def: ProductDef): Promise<Stripe.Product> {
  // Buscar por metadata.fichaje_key.
  const list = await stripe.products.search({
    query: `metadata['fichaje_key']:'${def.fichajeKey}'`,
    limit: 1,
  });
  if (list.data.length > 0) {
    const existing = list.data[0]!;
    if (existing.name !== def.name || existing.description !== def.description) {
      return stripe.products.update(existing.id, {
        name: def.name,
        description: def.description,
      });
    }
    return existing;
  }
  return stripe.products.create({
    name: def.name,
    description: def.description,
    metadata: { fichaje_key: def.fichajeKey },
  });
}

async function upsertPrice(
  product: Stripe.Product,
  def: ProductDef["prices"][number],
): Promise<Stripe.Price> {
  // Buscar por lookup_key (Stripe lo permite como "alias" único).
  const existing = await stripe.prices.list({
    lookup_keys: [def.lookupKey],
    limit: 1,
  });
  if (existing.data.length > 0) {
    const p = existing.data[0]!;
    if (
      p.unit_amount === def.amountCents &&
      p.recurring?.interval === def.interval &&
      p.product === product.id
    ) {
      return p;
    }
    // El price es inmutable en Stripe — si cambian los importes, hay que
    // crear uno nuevo y desactivar el anterior. Por simplicidad de Fase
    // 4 inicial, lanzamos para que el operador decida.
    throw new Error(
      `Price con lookup_key ${def.lookupKey} ya existe con valores distintos. ` +
        `Stripe no permite editar prices; cambia el lookup_key o desactiva ` +
        `el anterior manualmente.`,
    );
  }
  return stripe.prices.create({
    product: product.id,
    unit_amount: def.amountCents,
    currency: "eur",
    recurring: { interval: def.interval },
    lookup_key: def.lookupKey,
    metadata: { fichaje_key: def.lookupKey },
  });
}

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    console.error("Falta STRIPE_SECRET_KEY.");
    process.exit(2);
  }
  const isLive = secret.startsWith("sk_live_");
  const allowLive = process.env.STRIPE_BOOTSTRAP_ALLOW_LIVE === "1";
  if (isLive && !allowLive) {
    console.error(
      "ERROR: key sk_live detectada. Este script creará productos/precios\n" +
        "en la cuenta REAL de Stripe (cobros de verdad). Si es lo que quieres,\n" +
        "re-ejecuta añadiendo STRIPE_BOOTSTRAP_ALLOW_LIVE=1.",
    );
    process.exit(2);
  }
  if (isLive) {
    console.log(
      "⚠️  MODO LIVE — creando productos/precios en la cuenta REAL de Stripe.\n",
    );
  }

  const out: Record<string, string> = {};

  for (const def of PRODUCTS) {
    console.log(`→ ${def.fichajeKey}`);
    const product = await upsertProduct(def);
    for (const priceDef of def.prices) {
      const price = await upsertPrice(product, priceDef);
      const envKey = lookupKeyToEnvVar(priceDef.lookupKey);
      out[envKey] = price.id;
      console.log(`   ${envKey}=${price.id}`);
    }
  }

  console.log("\n─── Copia estas líneas a tu .env ───");
  for (const [k, v] of Object.entries(out)) {
    console.log(`${k}="${v}"`);
  }
}

function lookupKeyToEnvVar(lookupKey: string): string {
  // plan_starter_monthly → STRIPE_PRICE_STARTER_MONTHLY
  // addon_api_access     → STRIPE_PRICE_ADDON_API_ACCESS
  return "STRIPE_PRICE_" + lookupKey.toUpperCase().replace(/^PLAN_/, "");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
