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
  // Detrás del proxy (Traefik/Dokploy), req.url lleva el host interno del
  // contenedor (0.0.0.0:3000) → un redirect con él rompe (ERR_SSL_PROTOCOL).
  // Construimos la URL con el host/proto reenviados por el proxy.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const loginUrl = host ? `${proto}://${host}/admin/login` : new URL("/admin/login", req.url).toString();
  const res = NextResponse.redirect(loginUrl, { status: 303 });
  res.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
});
