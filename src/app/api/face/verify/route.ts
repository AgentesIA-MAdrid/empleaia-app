/**
 * POST /api/face/verify
 *
 * El cliente computa un embedding (face-api.js) y lo manda. El backend
 * descifra el template del usuario y calcula similitud cosine. Si
 * supera el umbral, devuelve `match: true` + un `faceVerifyToken`
 * HMAC-firmado con TTL 60s y single-use que el cliente debe enviar
 * en `POST /api/fichajes` para certificar la verificación.
 *
 * Sin token, el handler de fichajes no acepta `faceIdObligatorio` (el
 * boolean `faceVerified` antiguo era client-trust → eliminado).
 *
 * Rate limit: 10 intentos por usuario+IP cada 60s.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { decryptFloat32 } from "@/lib/crypto/aes-gcm";
import { euclideanDistance, FACE_MATCH_THRESHOLD } from "@/lib/face/similitud";
import { issueFaceToken } from "@/lib/face/token";
import { checkRate } from "@/lib/rate-limit";
import { currentTenant } from "@/lib/tenant/context";

const schema = z.object({
  embedding: z.array(z.number()).length(128),
  fichajeId: z.string().optional(),
});

export const POST = withTenant(withFeature("face_id", async (req: NextRequest) => {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : "unknown";

  const rate = checkRate(`face-verify:${user.id}:${ip}`, 10, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Demasiadas verificaciones. Espera unos segundos." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  const tpl = await prismaApp.faceTemplate.findUnique({
    where: { userId: user.id },
    select: { id: true, embeddingEnc: true },
  });
  if (!tpl) {
    return NextResponse.json(
      { error: "No tienes una plantilla biométrica. Regístrala primero en Face ID → Mi Face ID." },
      { status: 404 },
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body inválido" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Embedding inválido" }, { status: 400 });
  }

  const candidate = new Float32Array(parsed.data.embedding);
  const stored = decryptFloat32(tpl.embeddingEnc);
  // `score` es la distancia euclidiana: menor = más parecido. Match si
  // está por debajo del umbral. (Antes se usaba coseno >= umbral, que
  // dejaba pasar a cualquiera — ver lib/face/similitud.ts.)
  const score = euclideanDistance(stored, candidate);
  const match = score <= FACE_MATCH_THRESHOLD;

  const ua = req.headers.get("user-agent");

  await prismaApp.faceVerificacion.create({
    data: {
      templateId: tpl.id,
      score,
      resultado: match ? "match" : "no_match",
      ip: ip === "unknown" ? null : ip,
      userAgent: ua,
      fichajeId: parsed.data.fichajeId ?? null,
    },
  });

  if (!match) {
    return NextResponse.json({ match: false, score, threshold: FACE_MATCH_THRESHOLD });
  }

  const faceVerifyToken = issueFaceToken(user.id, currentTenant().slug);

  return NextResponse.json({
    match: true,
    score,
    threshold: FACE_MATCH_THRESHOLD,
    faceVerifyToken,
  });
}));
