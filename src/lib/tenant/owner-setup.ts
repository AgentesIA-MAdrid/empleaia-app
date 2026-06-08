/**
 * Provisión del primer OWNER de un tenant + email de bienvenida.
 *
 * Extraído de `checkout-session-completed.ts` para compartirlo entre:
 *  - el webhook de Stripe (flujo con pago), y
 *  - el alta directa sin tarjeta (`registro/actions.ts` →
 *    `provisionTenantDirect`).
 *
 * El OWNER se crea SIN contraseña; recibe un `resetToken` (TTL 24h) y un
 * email con el enlace de set-password. Idempotente vía upsert por email.
 */

import crypto from "node:crypto";
import { prismaApp } from "@/lib/prisma";
import { runWithTenant, type TenantContext } from "@/lib/tenant/context";
import { sendEmail } from "@/lib/email/send";
import {
  bienvenidaSubject,
  bienvenidaHtml,
  bienvenidaText,
} from "@/lib/email-templates/bienvenida";

const RESET_TOKEN_TTL_HOURS = 24;

export type TenantOwnerInput = {
  id: string;
  slug: string;
  name: string;
  email: string;
};

/**
 * Crea el primer OWNER en el schema del tenant (sin password, con
 * resetToken) y siembra `ConfiguracionEmpresa` con el nombre del tenant.
 * Debe llamarse después de `provisionTenantSchema` +
 * `invalidateTenantClient`. Devuelve el resetToken generado.
 */
export async function createOwnerAndSeed(
  tenant: TenantOwnerInput,
): Promise<string> {
  const ctx: TenantContext = {
    tenantId: tenant.id,
    slug: tenant.slug,
    // Para entrar a runWithTenant; el caller sincroniza
    // master.tenants.status = active aparte.
    status: "active",
    features: new Map(),
  };
  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetTokenExpiry = new Date(
    Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000,
  );

  await runWithTenant(ctx, async () => {
    // El email puede haber tenido espacios o variaciones; normalizamos.
    const email = tenant.email.trim().toLowerCase();
    const [nombre, ...rest] = (tenant.name ?? email.split("@")[0]).split(" ");
    const apellidos = rest.join(" ") || "";
    await prismaApp.user.upsert({
      where: { email },
      create: {
        email,
        nombre: nombre || "Owner",
        apellidos,
        rol: "OWNER",
        password: null,
        resetToken,
        resetTokenExpiry,
        activo: true,
      },
      update: {
        rol: "OWNER",
        resetToken,
        resetTokenExpiry,
        activo: true,
      },
    });

    // Sembrar `ConfiguracionEmpresa` con el nombre que el cliente
    // introdujo en /registro. id fijo 'singleton' para evitar duplicados
    // (la UI de configuración usa el mismo id).
    if (tenant.name) {
      await prismaApp.configuracionEmpresa.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", nombre: tenant.name },
        update: { nombre: tenant.name },
      });
    }
  });

  return resetToken;
}

/**
 * Envía el email de bienvenida con el enlace de set-password. No lanza:
 * un fallo de email no debe bloquear el alta (el OWNER puede recuperar
 * el acceso vía "olvidé mi contraseña"). Loguea el error.
 */
export async function sendWelcomeEmail(
  tenant: TenantOwnerInput,
  resetToken: string,
): Promise<void> {
  const setPasswordUrl = buildSetPasswordUrl(tenant.slug, resetToken);
  const params = {
    ownerEmail: tenant.email,
    ownerName: tenant.name,
    tenantSlug: tenant.slug,
    setPasswordUrl,
    appName: "Fichaje",
  };
  try {
    await sendEmail({
      to: tenant.email,
      from: process.env.EMAIL_FROM ?? "no-reply@ficha.tecnocloud.es",
      subject: bienvenidaSubject(params),
      html: bienvenidaHtml(params),
      text: bienvenidaText(params),
    });
  } catch (err) {
    console.error(
      `[owner-setup] fallo al enviar email de bienvenida a ${tenant.email}:`,
      err,
    );
  }
}

export function buildSetPasswordUrl(slug: string, token: string): string {
  const root = process.env.TENANT_ROOT_DOMAIN ?? "ficha.tecnocloud.es";
  const proto = root === "localhost" ? "http" : "https";
  const port = root === "localhost" ? ":3000" : "";
  return `${proto}://${slug}.${root}${port}/set-password?token=${token}`;
}
