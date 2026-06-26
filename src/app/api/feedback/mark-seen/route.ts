import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant/with-tenant";
import { markTicketsSeenByUser } from "@/lib/feedback/repository";

// POST /api/feedback/mark-seen — quita el badge de "tienes respuesta".
export const POST = withTenant(async () => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  await markTicketsSeenByUser(session.user.id!);
  return NextResponse.json({ ok: true });
});
