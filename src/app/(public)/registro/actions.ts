/**
 * Server action del formulario /registro. ADR-003 §2.6 + Enmienda 1
 * del plan de Fase 4 (server actions del subdominio app usan
 * prismaMaster, NO prismaApp).
 */

"use server";

import { redirect } from "next/navigation";
import { prismaMaster } from "@/lib/prisma";
import { registroSchema, suggestSlugAlternatives } from "@/lib/registro/schema";
import { provisionTenantDirect } from "@/lib/registro/provision-direct";

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

  // 3. INSERT master.tenants con prismaMaster (Enmienda 1 del plan).
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

  // 4. Provisionar el tenant directamente, SIN tarjeta (Stripe sale del
  //    alta temporalmente; se reintegrará por el webhook al cambiar de
  //    cuenta). Crea schema + migraciones + OWNER + features del plan, y
  //    deja el tenant en `active`. Es síncrono (5-15s típicamente).
  try {
    await provisionTenantDirect(
      {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        email: tenant.email,
      },
      data.planKey,
    );
  } catch (err) {
    console.error(
      `[registro] fallo al provisionar tenant ${tenant.slug}:`,
      err,
    );
    return {
      kind: "error",
      message:
        "No pudimos preparar tu cuenta. Inténtalo de nuevo en unos minutos o contacta con soporte.",
    };
  }

  // 5. Redirect a la página de éxito (revisa email para set-password).
  redirect(`/registro/exito?slug=${encodeURIComponent(tenant.slug)}`);
}
