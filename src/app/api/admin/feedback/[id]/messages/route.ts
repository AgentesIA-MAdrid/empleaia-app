import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { getTicketById, listMessages, addMessage, updateTicket, getTicketUserEmail } from "@/lib/feedback/repository";
import { sendAdminReplyEmail } from "@/lib/feedback/send-emails";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ticketIdFromUrl(url: string): string | null {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const id = segments[segments.indexOf("feedback") + 1];
  return id && UUID_RE.test(id) ? id : null;
}

// GET — hilo COMPLETO (incluye mensajes internos).
export const GET = withSuperAdmin(async (req: NextRequest) => {
  const id = ticketIdFromUrl(req.url);
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  const ticket = await getTicketById(id);
  if (!ticket) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
  return NextResponse.json(await listMessages(id));
});

const postSchema = z.object({
  cuerpo: z.string().min(1).max(5000),
  internal: z.boolean().optional(),
});

// POST — responder (público o nota interna).
export const POST = withSuperAdmin(async (req: NextRequest) => {
  const id = ticketIdFromUrl(req.url);
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const ticket = await getTicketById(id);
  if (!ticket) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });

  const internal = parsed.data.internal === true;
  const message = await addMessage({
    ticket_id: id,
    autor: "admin",
    user_id: currentSuperAdmin().id,
    cuerpo: parsed.data.cuerpo,
    internal,
  });

  await updateTicket(id, {
    ...(internal ? {} : { visto_por_user: false }),
    ...(ticket.estado === "nuevo" ? { estado: "en_revision" } : {}),
  });

  if (!internal) {
    void getTicketUserEmail(id).then((email) => {
      if (email) {
        return sendAdminReplyEmail(
          { id: ticket.id, tipo: ticket.tipo, descripcion: ticket.descripcion, pagina: ticket.pagina },
          parsed.data.cuerpo,
          email,
        );
      }
    }).catch((e) => console.error("[admin/feedback/messages] sendAdminReplyEmail failed", e));
  }

  return NextResponse.json(message, { status: 201 });
});
