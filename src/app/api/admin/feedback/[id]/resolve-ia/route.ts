import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { getTicketById, enqueueAiJob, updateTicket, addMessage } from "@/lib/feedback/repository";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  comment: z.string().trim().max(2000).optional(),
  prompt_override: z.string().trim().max(20_000).optional(),
});

// POST /api/admin/feedback/[id]/resolve-ia — encola un job "Resolver con Claude".
// Dedupe: 409 si ya hay un job vivo. `comment` → instrucción interna previa.
export const POST = withSuperAdmin(async (req: NextRequest) => {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segments[segments.indexOf("feedback") + 1];
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const comment = parsed.data.comment?.trim() || "";
  const promptOverride = parsed.data.prompt_override?.trim() || "";

  const ticket = await getTicketById(id);
  if (!ticket) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });

  const adminId = currentSuperAdmin().id;
  if (comment) {
    await addMessage({ ticket_id: id, autor: "admin", user_id: adminId, cuerpo: comment, internal: true });
  }

  const result = await enqueueAiJob(id, adminId, "opus", promptOverride || null);
  if (!result.ok) {
    return NextResponse.json({ error: "Ya hay un job activo para este ticket", code: result.reason }, { status: 409 });
  }
  if (ticket.estado === "nuevo") {
    try {
      await updateTicket(id, { estado: "en_revision" });
    } catch {
      /* best-effort */
    }
  }
  return NextResponse.json(result.job, { status: 202 });
});
