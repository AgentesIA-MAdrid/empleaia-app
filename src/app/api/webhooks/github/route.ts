/**
 * Webhook de GitHub para auto-resolver tickets al mergear su PR.
 *
 * - Sin NextAuth, sin withTenant (whitelist `/api/webhooks/**` en AGENTS.md).
 *   Es global, no pertenece a ningún tenant → usa prismaMaster vía repository.
 * - Verifica la firma HMAC-SHA256 (`x-hub-signature-256`) sobre el body RAW
 *   con GITHUB_WEBHOOK_SECRET. Body raw obligatorio (`req.text()`).
 * - Solo actúa en `pull_request` con `action: closed` y `merged: true`.
 *   Localiza el job por rama (`head.ref`) o URL del PR y dispara
 *   resolvePrMerged: publica al cliente + marca resuelto + job → desplegado.
 * - Responde 200 SIEMPRE (incluso si no hay match) para que GitHub no reintente.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { resolvePrMerged } from "@/lib/feedback/auto-resolve";

export const runtime = "nodejs";

function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhooks/github] GITHUB_WEBHOOK_SECRET no definida.");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const raw = await req.text(); // RAW, NO json() — la firma se calcula sobre los bytes.
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  // ping (al crear el webhook) → 200 para que GitHub lo marque activo.
  if (event === "ping") return NextResponse.json({ ok: true, pong: true });
  if (event !== "pull_request") return NextResponse.json({ ok: true, ignored: event });

  let payload: {
    action?: string;
    pull_request?: { merged?: boolean; html_url?: string; head?: { ref?: string } };
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  const pr = payload.pull_request;
  if (payload.action !== "closed" || !pr?.merged) {
    return NextResponse.json({ ok: true, ignored: `${payload.action}/${pr?.merged}` });
  }

  try {
    const result = await resolvePrMerged({
      branch: pr.head?.ref ?? null,
      prUrl: pr.html_url ?? null,
    });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[webhooks/github] resolvePrMerged falló", e);
    // 200 igualmente: un 5xx haría a GitHub reintentar en bucle.
    return NextResponse.json({ ok: false, error: "internal" });
  }
}
