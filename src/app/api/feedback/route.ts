import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant/with-tenant";
import { currentTenant } from "@/lib/tenant/context";
import { prismaApp } from "@/lib/prisma";
import { feedbackSubmitSchema } from "@/lib/feedback/schema";
import { checkFeedbackRateLimit } from "@/lib/feedback/rate-limit";
import { createTicket, getTicketOrgName } from "@/lib/feedback/repository";
import { sendNewTicketAlert } from "@/lib/feedback/send-emails";
import { notifyNuevoTicket } from "@/lib/telegram/notify";

// POST /api/feedback — el empleado/manager crea un ticket desde el widget.
// withTenant da el tenant activo; la sesión, el usuario.
export const POST = withTenant(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = session.user.id!;
  const { tenantId } = currentTenant();

  const body = await req.json().catch(() => null);
  const parsed = feedbackSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }

  if (!checkFeedbackRateLimit(tenantId).allowed) {
    return NextResponse.json({ error: "Demasiados tickets enviados hoy. Inténtalo mañana." }, { status: 429 });
  }

  const u = await prismaApp.user.findUnique({
    where: { id: userId },
    select: { nombre: true, apellidos: true, email: true },
  });
  const userNombre = u ? `${u.nombre} ${u.apellidos}`.trim() : null;

  const ticket = await createTicket({
    org_id: tenantId,
    user_id: userId,
    user_email: u?.email ?? null,
    user_nombre: userNombre,
    ...parsed.data,
  });

  // Aviso al equipo (email + Telegram) — fire and forget.
  void getTicketOrgName(tenantId).then((nombre) => {
    const t = { id: ticket.id, numero: ticket.numero, tipo: parsed.data.tipo, descripcion: parsed.data.descripcion, pagina: parsed.data.pagina };
    void sendNewTicketAlert(t, { id: tenantId, nombre }, { email: u?.email ?? "", full_name: userNombre }).catch(() => {});
    void notifyNuevoTicket(t, nombre, userNombre ?? u?.email ?? "").catch(() => {});
  }).catch(() => {});

  return NextResponse.json({ id: ticket.id, created_at: ticket.created_at }, { status: 201 });
});
