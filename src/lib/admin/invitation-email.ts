/**
 * Email de invitación a un nuevo super-admin del panel.
 *
 * Envío DE SISTEMA (`sendSystemEmail`, Resend global) — el panel no
 * pertenece a ningún tenant, así que NO usamos el Resend BYOK del
 * tenant. Branding fijo empleaIA.
 */

const PRIMARY = "#6366f1";
const SIDEBAR = "#1e1b4b";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function adminInvitationSubject(): string {
  return "Te han invitado al panel super-admin de empleaIA";
}

export function adminInvitationTemplate(params: {
  acceptUrl: string;
  role: "SUPER_ADMIN" | "SUPPORT";
  invitedByEmail?: string | null;
}): string {
  const { acceptUrl, role, invitedByEmail } = params;
  const rolLabel =
    role === "SUPER_ADMIN" ? "Administrador completo" : "Soporte";
  const invitedByLine = invitedByEmail
    ? `<p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:22px;">Invitación enviada por <strong>${escapeHtml(invitedByEmail)}</strong>.</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invitación al panel super-admin</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f1f5f9;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">
          <tr>
            <td style="background:${SIDEBAR};border-radius:12px 12px 0 0;padding:32px 32px 28px;text-align:center;">
              <span style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">emplea<span style="color:${PRIMARY};">IA</span></span>
              <div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,0.6);">Panel super-admin</div>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:32px;border-radius:0 0 12px 12px;">
              <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">Te han invitado como ${escapeHtml(rolLabel)}</h1>
              ${invitedByLine}
              <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:22px;">
                Has recibido acceso al control plane interno de empleaIA. Pulsa el botón
                para crear tu cuenta y establecer tu contraseña. El enlace caduca en 7 días.
              </p>
              <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 24px;">
                <tr>
                  <td style="border-radius:10px;background:${PRIMARY};">
                    <a href="${acceptUrl}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Crear mi cuenta</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:18px;word-break:break-all;">
                Si el botón no funciona, copia este enlace en tu navegador:<br />
                <a href="${acceptUrl}" style="color:${PRIMARY};">${acceptUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 8px;text-align:center;color:#94a3b8;font-size:11px;">
              Si no esperabas esta invitación, ignora este correo.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
