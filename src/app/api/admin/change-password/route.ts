import { NextResponse, type NextRequest } from "next/server";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { prismaMaster } from "@/lib/prisma";
import bcrypt from "bcryptjs";

// POST /api/admin/change-password — el super-admin cambia su propia contraseña.
export const POST = withSuperAdmin(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
  }
  const hash = await bcrypt.hash(newPassword, 12);
  await prismaMaster.superAdmin.update({
    where: { id: currentSuperAdmin().id },
    data: { password: hash },
  });
  return NextResponse.json({ ok: true });
});
