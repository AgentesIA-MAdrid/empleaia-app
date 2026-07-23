/**
 * POST /api/admin/logout — clear cookie + audit, then redirect to login.
 *
 * El botón "Salir" es un <form method="POST">, así que el navegador navega a
 * la respuesta. Devolvemos un redirect 303 a /admin/login (en vez de JSON)
 * para que el super-admin acabe en la pantalla de login, no viendo el JSON.
 *
 * IMPORTANTE: NO usa `withSuperAdmin`. Cerrar sesión debe funcionar también
 * con la sesión ya caducada — si exigiéramos JWT válido, el "Salir" tras un
 * rato de inactividad devolvía `401 {"error":"No autorizado"}` en crudo en el
 * navegador en lugar de llevar al login. Verificamos el token a mano solo
 * para poder auditar quién salió; si no hay sesión válida, limpiamos la
 * cookie igualmente y redirigimos.
 */

import { type NextRequest, NextResponse } from "next/server";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";
import { verifySuperAdminJwt, ADMIN_COOKIE_NAME } from "@/lib/admin/jwt";

export const POST = async (req: NextRequest) => {
  // Auditoría best-effort: solo si el token sigue siendo válido sabemos quién
  // es; con sesión caducada no hay nada fiable que auditar.
  try {
    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const claims = token ? await verifySuperAdminJwt(token) : null;
    if (claims) {
      const meta = extractRequestMeta(req.headers);
      await writeAuditEntry({
        superAdminId: claims.sub,
        action: "super-admin:logout",
        targetKind: "session",
        targetId: claims.sub,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
  } catch {
    // Un fallo de auditoría nunca debe impedir salir.
  }

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
};
