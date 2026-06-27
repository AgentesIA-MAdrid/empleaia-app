/**
 * /api/ia/config — configuración del proveedor de IA del tenant (BYOK).
 *
 *   GET   → devuelve config (sin la API key, solo metadata: provider,
 *           modelo, activa, ultimaPruebaOk).
 *   PUT   → guarda/actualiza config. Si se manda `apiKey` en body se
 *           cifra y reemplaza la anterior. Si NO se manda, se conserva.
 *   DELETE → borra la config (singleton).
 *
 * Solo OWNER puede gestionar. La API key NUNCA se devuelve en GET.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { encryptString } from "@/lib/crypto/aes-gcm";

const PROVIDERS = ["anthropic", "openai", "google"] as const;

const putSchema = z.object({
  provider: z.enum(PROVIDERS),
  apiKey: z.string().min(8).max(500).optional(),
  modelo: z.string().min(2).max(120),
  endpointUrl: z.string().url().optional().or(z.literal("")),
  systemPrompt: z.string().max(10_000).optional(),
  activa: z.boolean().default(true),
});

export const GET = withTenant(withFeature("asistente_ia", async () => {
  const session = await auth();
  const user = session?.user as { rol?: Rol | string } | undefined;
  if (user?.rol !== Rol.OWNER) {
    return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
  }
  const cfg = await prismaApp.iAConfiguracion.findUnique({
    where: { id: "default" },
    select: {
      provider: true,
      modelo: true,
      endpointUrl: true,
      systemPrompt: true,
      activa: true,
      ultimaPruebaAt: true,
      ultimaPruebaOk: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ config: cfg });
}));

export const PUT = withTenant(withFeature("asistente_ia", async (req: NextRequest) => {
  const session = await auth();
  const user = session?.user as { rol?: Rol | string } | undefined;
  if (user?.rol !== Rol.OWNER) {
    return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Si nos pasan apiKey la ciframos. Si no, conservamos la existente.
  const existing = await prismaApp.iAConfiguracion.findUnique({
    where: { id: "default" },
    select: { apiKeyEnc: true },
  });
  if (!data.apiKey && !existing) {
    return NextResponse.json(
      { error: "Falta apiKey en la primera configuración" },
      { status: 400 },
    );
  }
  let apiKeyEnc: Uint8Array<ArrayBuffer>;
  try {
    apiKeyEnc = data.apiKey ? encryptString(data.apiKey) : (existing!.apiKeyEnc as Uint8Array<ArrayBuffer>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error cifrando la API key";
    return NextResponse.json(
      {
        error: message.includes("IA_ENCRYPTION_KEY")
          ? "El servidor no tiene configurada la clave de cifrado IA_ENCRYPTION_KEY. Contacta con tu administrador del SaaS."
          : message,
      },
      { status: 500 },
    );
  }

  const cfg = await prismaApp.iAConfiguracion.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      provider: data.provider,
      modelo: data.modelo,
      apiKeyEnc,
      endpointUrl: data.endpointUrl || null,
      systemPrompt: data.systemPrompt || null,
      activa: data.activa,
    },
    update: {
      provider: data.provider,
      modelo: data.modelo,
      apiKeyEnc,
      endpointUrl: data.endpointUrl || null,
      systemPrompt: data.systemPrompt || null,
      activa: data.activa,
      // Reset estado de prueba al cambiar config.
      ultimaPruebaAt: null,
      ultimaPruebaOk: null,
    },
    select: {
      provider: true,
      modelo: true,
      endpointUrl: true,
      activa: true,
    },
  });

  return NextResponse.json({ config: cfg });
}));

export const DELETE = withTenant(withFeature("asistente_ia", async () => {
  const session = await auth();
  const user = session?.user as { rol?: Rol | string } | undefined;
  if (user?.rol !== Rol.OWNER) {
    return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
  }
  await prismaApp.iAConfiguracion.deleteMany({ where: { id: "default" } });
  return NextResponse.json({ ok: true });
}));
