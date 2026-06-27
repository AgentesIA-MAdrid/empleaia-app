/**
 * POST /api/ia/conversaciones/[id]/mensajes
 *
 * Envía un mensaje del usuario, lo persiste, llama al LLM con el
 * historial completo de la conversación + system prompt, persiste la
 * respuesta del assistant y la devuelve. Sin streaming en MVP.
 *
 * Si la conversación tiene título "Nueva conversación", se actualiza
 * con un título derivado del primer mensaje (truncado a 60 chars).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { decryptString } from "@/lib/crypto/aes-gcm";
import { chat, type ChatMessage } from "@/lib/ia/llm-client";
import { buildContextoTenant, defaultSystemPrompt } from "@/lib/ia/system-prompt";

const schema = z.object({
  contenido: z.string().min(1).max(20_000),
});

export const POST = withTenant(withFeature("asistente_ia", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;

  const conv = await prismaApp.conversacionIA.findUnique({
    where: { id },
    include: { mensajes: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (conv.userId !== user.id) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }

  const cfg = await prismaApp.iAConfiguracion.findUnique({ where: { id: "default" } });
  if (!cfg || !cfg.activa) {
    return NextResponse.json(
      { error: "El asistente IA no está configurado. Pide al OWNER que configure su API key en Configuración → IA." },
      { status: 412 },
    );
  }

  // Persistir mensaje del usuario.
  const userMsg = await prismaApp.mensajeIA.create({
    data: {
      conversacionId: id,
      rol: "user",
      contenido: parsed.data.contenido,
    },
  });

  // Construir historial + system prompt.
  const ctx = await buildContextoTenant();
  const systemPrompt = cfg.systemPrompt ?? defaultSystemPrompt(ctx);
  const messages: ChatMessage[] = [
    { rol: "system", contenido: systemPrompt },
    ...conv.mensajes.map((m) => ({
      rol: m.rol as "user" | "assistant",
      contenido: m.contenido,
    })),
    { rol: "user", contenido: parsed.data.contenido },
  ];

  // Llamar al LLM (BYOK del tenant).
  let assistantText = "";
  let tokensInput = 0;
  let tokensOutput = 0;
  let modelo: string | null = null;
  let errorMsg: string | null = null;
  try {
    const apiKey = decryptString(cfg.apiKeyEnc);
    const r = await chat(
      {
        provider: cfg.provider,
        apiKey,
        modelo: cfg.modelo,
        endpointUrl: cfg.endpointUrl,
      },
      messages,
    );
    assistantText = r.contenido;
    tokensInput = r.tokensInput;
    tokensOutput = r.tokensOutput;
    modelo = r.modelo;
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e);
  }

  // Persistir respuesta (o error) y actualizar updatedAt.
  const assistantMsg = await prismaApp.mensajeIA.create({
    data: {
      conversacionId: id,
      rol: "assistant",
      contenido: assistantText || `[Error] ${errorMsg ?? "Sin respuesta"}`,
      tokensInput,
      tokensOutput,
      modelo,
      errorMsg,
    },
  });

  // Renombrar conversación si aún tiene título placeholder.
  let convUpdate = { updatedAt: new Date() };
  if (conv.titulo === "Nueva conversación") {
    const titulo = parsed.data.contenido
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    convUpdate = { ...convUpdate, titulo } as typeof convUpdate & { titulo: string };
  }
  await prismaApp.conversacionIA.update({
    where: { id },
    data: convUpdate,
  });

  if (errorMsg) {
    return NextResponse.json(
      { userMsg, assistantMsg, error: errorMsg },
      { status: 502 },
    );
  }
  return NextResponse.json({ userMsg, assistantMsg });
}));
