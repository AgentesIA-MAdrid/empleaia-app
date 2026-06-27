import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant/with-tenant";
import { getTicketById, adjuntoBelongsToTicket } from "@/lib/feedback/repository";
import { getAdjuntoBytes } from "@/lib/feedback/screenshot-storage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Defensa en profundidad: aunque /upload ya valida el MIME al subir, no servimos
// el content-type almacenado a ciegas. Cualquier tipo fuera de esta allowlist se
// degrada a octet-stream para que el navegador no lo interprete como HTML/JS.
const SAFE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

function ticketIdFromUrl(url: string): string | null {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const id = segments[segments.indexOf("my-tickets") + 1];
  return id && UUID_RE.test(id) ? id : null;
}

// GET /api/feedback/my-tickets/[id]/screenshot?adjunto=<id>
// Sirve los bytes de un adjunto (captura del ticket, de un mensaje del hilo o
// del resumen de un job) si el ticket es del usuario y el adjunto le pertenece.
export const GET = withTenant(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const id = ticketIdFromUrl(req.url);
  if (!id) return NextResponse.json({ error: "ID de ticket inválido" }, { status: 400 });

  const adjuntoId = new URL(req.url).searchParams.get("adjunto");
  if (!adjuntoId || !UUID_RE.test(adjuntoId)) {
    return NextResponse.json({ error: "Adjunto inválido" }, { status: 400 });
  }

  const ticket = await getTicketById(id);
  if (!ticket || ticket.user_id !== session.user.id) {
    return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
  }

  if (!(await adjuntoBelongsToTicket(adjuntoId, id))) {
    return NextResponse.json({ error: "Adjunto no encontrado" }, { status: 404 });
  }

  const bytes = await getAdjuntoBytes(adjuntoId);
  if (!bytes) return NextResponse.json({ error: "Adjunto no encontrado" }, { status: 404 });
  const safeType = SAFE_IMAGE_TYPES.has(bytes.contentType) ? bytes.contentType : "application/octet-stream";
  return new Response(new Uint8Array(bytes.data), {
    headers: {
      "Content-Type": safeType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
