/**
 * POST /api/ia/test — verifica que la config IA actual funciona
 * pidiéndole al LLM una respuesta breve. Actualiza
 * `ultimaPruebaAt` y `ultimaPruebaOk` en BD para reflejarlo en UI.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { decryptString } from "@/lib/crypto/aes-gcm";
import { ping } from "@/lib/ia/llm-client";

export const POST = withTenant(withFeature("asistente_ia", async () => {
  const session = await auth();
  const user = session?.user as { rol?: Rol | string } | undefined;
  if (user?.rol !== Rol.OWNER) {
    return NextResponse.json({ error: "Solo OWNER" }, { status: 403 });
  }
  const cfg = await prismaApp.iAConfiguracion.findUnique({
    where: { id: "default" },
  });
  if (!cfg) {
    return NextResponse.json({ error: "Sin configuración" }, { status: 404 });
  }
  const apiKey = decryptString(cfg.apiKeyEnc);
  const result = await ping({
    provider: cfg.provider,
    apiKey,
    modelo: cfg.modelo,
    endpointUrl: cfg.endpointUrl,
  });

  await prismaApp.iAConfiguracion.update({
    where: { id: "default" },
    data: {
      ultimaPruebaAt: new Date(),
      ultimaPruebaOk: result.ok,
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, modelo: result.modelo });
}));
