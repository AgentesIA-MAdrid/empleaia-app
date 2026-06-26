import { NextResponse, type NextRequest } from "next/server";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { getTicketById } from "@/lib/feedback/repository";
import { getAdjuntoBytes } from "@/lib/feedback/screenshot-storage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/admin/feedback/[id]/screenshot
//   ?adjunto=<id>  → sirve los BYTES de esa captura (img).
//   (sin adjunto)  → JSON { paths } con los ids de las capturas del ticket.
export const GET = withSuperAdmin(async (req: NextRequest) => {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segments[segments.indexOf("feedback") + 1];
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const adjuntoId = new URL(req.url).searchParams.get("adjunto");
  if (adjuntoId) {
    const bytes = await getAdjuntoBytes(adjuntoId);
    if (!bytes) return NextResponse.json({ error: "Adjunto no encontrado" }, { status: 404 });
    return new Response(new Uint8Array(bytes.data), {
      headers: { "Content-Type": bytes.contentType, "Cache-Control": "private, max-age=3600" },
    });
  }

  const ticket = await getTicketById(id);
  if (!ticket) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
  return NextResponse.json({ paths: ticket.screenshot_paths ?? [] });
});
