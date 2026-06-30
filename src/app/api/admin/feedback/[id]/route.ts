import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { updateTicket, getTicketById, getTicketUserEmail } from "@/lib/feedback/repository";
import { sendResolutionEmail } from "@/lib/feedback/send-emails";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  estado: z.enum(["nuevo", "en_revision", "en_desarrollo", "resuelto", "descartado"]).optional(),
  notas_internas: z.string().max(5000).optional(),
});

// PATCH /api/admin/feedback/[id] — estado / notas. Si pasa a resuelto → email.
export const PATCH = withSuperAdmin(async (req: NextRequest) => {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segments[segments.indexOf("feedback") + 1];
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const ticket = await getTicketById(id);
  if (!ticket) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });

  const becomesResuelto = parsed.data.estado === "resuelto" && ticket.estado !== "resuelto";
  const updated = await updateTicket(id, parsed.data);

  if (becomesResuelto) {
    void getTicketUserEmail(id).then((email) => {
      if (email) {
        return sendResolutionEmail(
          { id: updated.id, numero: updated.numero, tipo: updated.tipo, descripcion: updated.descripcion, pagina: updated.pagina },
          email,
        );
      }
    }).catch((e) => console.error("[admin/feedback] sendResolutionEmail failed", e));
  }

  return NextResponse.json(updated);
});
