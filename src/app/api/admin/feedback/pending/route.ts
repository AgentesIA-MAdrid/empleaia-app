import { NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { countNuevos } from "@/lib/feedback/repository";

// GET /api/admin/feedback/pending — count de nuevos (para el banner).
export const GET = withSuperAdmin(async () => {
  return NextResponse.json(await countNuevos());
});
