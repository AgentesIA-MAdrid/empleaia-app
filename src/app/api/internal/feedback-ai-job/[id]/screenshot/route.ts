import { NextResponse } from "next/server";
import { z } from "zod";
import { requireServiceAuth } from "@/lib/internal/auth";
import { getAiJobById } from "@/lib/feedback/repository";
import { uploadScreenshotBuffer, FeedbackScreenshotError } from "@/lib/feedback/screenshot-storage";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// La imagen viaja en base64 dentro del JSON (firma HMAC sobre el body de texto).
const Body = z.object({
  image_base64: z.string().min(1).max(7_500_000),
  content_type: z.enum(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif", "image/gif"]),
  ext: z.string().max(8).optional(),
});

// POST /api/internal/feedback-ai-job/[id]/screenshot
// Sube la captura del "después" que generó Claude (el runner no toca BD).
// Devuelve { path } (id de FeedbackAdjunto) para el callback final. HMAC.
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const authError = requireServiceAuth(req, rawBody);
  if (authError) return authError;

  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const jobId = segments[segments.indexOf("feedback-ai-job") + 1];
  if (!jobId || !UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "job id inválido" }, { status: 400 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(JSON.parse(rawBody));
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid body", detail: e instanceof Error ? e.message : "parse error" },
      { status: 400 },
    );
  }

  const job = await getAiJobById(jobId);
  if (!job) return NextResponse.json({ error: "job no encontrado" }, { status: 404 });

  const buffer = Buffer.from(body.image_base64, "base64");
  try {
    const { path } = await uploadScreenshotBuffer(buffer, body.content_type);
    return NextResponse.json({ path });
  } catch (e) {
    if (e instanceof FeedbackScreenshotError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    console.error(`[feedback-ai-job] upload captura "después" falló (job ${jobId}):`, e);
    return NextResponse.json({ error: "upload fallido" }, { status: 500 });
  }
}
