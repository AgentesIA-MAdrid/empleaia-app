import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant/with-tenant";
import { currentTenant } from "@/lib/tenant/context";
import { prismaApp } from "@/lib/prisma";
import { getTicketById, listMessages, addMessage, updateTicket, getTicketOrgName, adjuntoIsOrphan } from "@/lib/feedback/repository";
import { sendUserReplyAlert } from "@/lib/feedback/send-emails";
import { notifyRespuestaCliente } from "@/lib/telegram/notify";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ticketIdFromUrl(url: string): string | null {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const id = segments[segments.indexOf("my-tickets") + 1];
  return id && UUID_RE.test(id) ? id : null;
}

// GET — hilo del usuario (solo mensajes internal=false; el diagnóstico técnico
// y las instrucciones a Claude no se devuelven al cliente).
export const GET = withTenant(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const id = ticketIdFromUrl(req.url);
  if (!id) return NextResponse.json({ error: "ID de ticket inválido" }, { status: 400 });

  const ticket = await getTicketById(id);
  if (!ticket || ticket.user_id !== session.user.id) {
    return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
  }
  return NextResponse.json(await listMessages(id, { includeInternal: false }));
});

const postSchema = z
  .object({
    cuerpo: z.string().max(5000).optional().default(""),
    adjunto_path: z.string().regex(UUID_RE).optional(),
  })
  .refine((d) => d.cuerpo.trim().length > 0 || !!d.adjunto_path, {
    message: "Escribe un mensaje o adjunta una imagen",
  });

// POST — el usuario responde en el hilo de su ticket.
export const POST = withTenant(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const id = ticketIdFromUrl(req.url);
  if (!id) return NextResponse.json({ error: "ID de ticket inválido" }, { status: 400 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const ticket = await getTicketById(id);
  if (!ticket || ticket.user_id !== userId) {
    return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
  }

  // Si adjunta una imagen, debe ser un adjunto huérfano (subido por él vía
  // /api/feedback/upload), no uno ya enlazado a otro ticket/mensaje.
  if (parsed.data.adjunto_path && !(await adjuntoIsOrphan(parsed.data.adjunto_path))) {
    return NextResponse.json({ error: "Adjunto inválido" }, { status: 400 });
  }

  const cuerpo = parsed.data.cuerpo.trim();
  const message = await addMessage({
    ticket_id: id,
    autor: "user",
    user_id: userId,
    cuerpo,
    adjunto_path: parsed.data.adjunto_path ?? null,
  });

  // Si el ticket ya estaba cerrado (resuelto/descartado), la respuesta del
  // usuario lo reabre: vuelve a 'en_revision' para que el equipo lo retome.
  // Sin esto, un ticket auto-resuelto al mergear el PR seguía marcado como
  // "resuelto" aunque el usuario respondiera que algo no funcionaba.
  if (ticket.estado === "resuelto" || ticket.estado === "descartado") {
    await updateTicket(id, { estado: "en_revision" });
  }

  // Aviso al super-admin — fire and forget.
  void (async () => {
    const u = await prismaApp.user.findUnique({
      where: { id: userId },
      select: { nombre: true, apellidos: true, email: true },
    });
    const nombre = await getTicketOrgName(ticket.org_id || currentTenant().tenantId);
    const t = { id: ticket.id, numero: ticket.numero, tipo: ticket.tipo, descripcion: ticket.descripcion, pagina: ticket.pagina };
    const userLabel = u ? `${u.nombre} ${u.apellidos}`.trim() : "";
    await sendUserReplyAlert(t, cuerpo || "[Imagen adjunta]", { id: ticket.org_id, nombre }, { email: u?.email ?? "", full_name: userLabel || null });
    void notifyRespuestaCliente(t, cuerpo || "[Imagen adjunta]", nombre, userLabel || u?.email || "").catch(() => {});
  })().catch((e) => console.error("[feedback/messages] sendUserReplyAlert failed", e));

  return NextResponse.json(message, { status: 201 });
});
