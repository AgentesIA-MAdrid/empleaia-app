import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant/with-tenant";
import { listByUser } from "@/lib/feedback/repository";

// GET /api/feedback/my-tickets — tickets del propio usuario.
export const GET = withTenant(async () => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json(await listByUser(session.user.id!));
});
