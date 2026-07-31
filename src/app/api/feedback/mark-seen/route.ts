import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant/with-tenant";
import { markTicketSeenByUser } from "@/lib/feedback/repository";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bodySchema = z.object({ ticketId: z.string().regex(UUID_RE) });

// POST /api/feedback/mark-seen — quita el punto rojo de UN ticket concreto (el
// usuario acaba de abrir ese hilo). Antes marcaba todos los del usuario al
// abrir el modal, y con ello se perdía cuál tenía la respuesta nueva.
// El `updateMany` filtra también por userId: un id ajeno no marca nada.
export const POST = withTenant(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  await markTicketSeenByUser(parsed.data.ticketId, session.user.id!);
  return NextResponse.json({ ok: true });
});
