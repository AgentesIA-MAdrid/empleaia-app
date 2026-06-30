/**
 * POST /api/admin/logout — clear cookie + audit, then redirect to login.
 *
 * El botón "Salir" es un <form method="POST">, así que el navegador navega a
 * la respuesta. Devolvemos un redirect 303 a /admin/login (en vez de JSON)
 * para que el super-admin acabe en la pantalla de login, no viendo el JSON.
 */

import { NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";
import { ADMIN_COOKIE_NAME } from "@/lib/admin/jwt";

export const POST = withSuperAdmin(async (req) => {
  const sa = currentSuperAdmin();
  const meta = extractRequestMeta(req.headers);
  await writeAuditEntry({
    superAdminId: sa.id,
    action: "super-admin:logout",
    targetKind: "session",
    targetId: sa.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  // Redirect con Location RELATIVO (RFC 7231 §7.1.2). El navegador lo resuelve
  // contra el origen actual (admin.empleaia.es), así que:
  //  - no depende de req.url (que detrás del proxy es el host interno
  //    0.0.0.0:3000 → ERR_SSL_PROTOCOL_ERROR), y
  //  - no confía en el header Host (evita open-redirect por host injection).
  // No usamos NextResponse.redirect porque exige URL absoluta.
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: "/admin/login" },
  });
  res.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
});
