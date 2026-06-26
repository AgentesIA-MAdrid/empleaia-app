import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import {
  getTicketById,
  getLatestAiJob,
  setAiJobResumenDraft,
  publishResumenToClient,
  getTicketUserEmail,
} from "@/lib/feedback/repository";
import { sendAdminReplyEmail } from "@/lib/feedback/send-emails";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({ resumen: z.string().trim().max(5000).optional() });

// POST /api/admin/feedback/[id]/resumen/publish — publica al cliente el resumen
// (borrador) del último job: lo vuelca al hilo + email. El diagnóstico queda interno.
export const POST = withSuperAdmin(async (req: NextRequest) => {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segments[segments.indexOf("feedback") + 1];
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const ticket = await getTicketById(id);
  if (!ticket) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });

  const job = await getLatestAiJob(id);
  if (!job) return NextResponse.json({ error: "Este ticket no tiene ningún job de Claude" }, { status: 404 });

  const edited = parsed.data.resumen?.trim();
  if (edited) await setAiJobResumenDraft(job.id, edited);

  const result = await publishResumenToClient(job.id);
  if (!result.ok) {
    const status = result.reason === "ya_publicado" ? 409 : 400;
    const msg =
      result.reason === "ya_publicado"
        ? "El resumen ya se publicó al cliente"
        : result.reason === "sin_resumen"
          ? "No hay resumen que publicar"
          : "No se pudo publicar el resumen";
    return NextResponse.json({ error: msg, code: result.reason }, { status });
  }

  void getTicketUserEmail(id).then((email) => {
    if (email) {
      return sendAdminReplyEmail(
        { id: ticket.id, tipo: ticket.tipo, descripcion: ticket.descripcion, pagina: ticket.pagina },
        result.message.cuerpo,
        email,
      );
    }
  }).catch((e) => console.error("[admin/feedback/resumen/publish] email falló", e));

  return NextResponse.json({ message: result.message }, { status: 201 });
});
