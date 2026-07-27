interface BienvenidaParams {
  nombre: string;
  apellidos: string;
  email: string;
  password: string;
  rol: string;
  empresa: string;
  colorPrimario: string;
  colorSidebar: string;
  logo?: string | null;
  appUrl?: string;
}

interface InvitacionParams {
  nombre: string;
  apellidos: string;
  email: string;
  rol: string;
  empresa: string;
  colorPrimario: string;
  colorSidebar: string;
  logo?: string | null;
  setPasswordUrl: string;
}

export function invitacionTemplate(params: InvitacionParams): string {
  const {
    nombre,
    apellidos,
    email,
    rol,
    empresa,
    colorPrimario,
    colorSidebar,
    logo,
    setPasswordUrl,
  } = params;

  const rolLabel = getRolLabel(rol);
  const priRgb = hexToRgb(colorPrimario);

  const logoHtml = logo
    ? `<img src="${logo}" alt="${empresa}" style="max-height:48px;max-width:180px;object-fit:contain;" />`
    : `<div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;background:rgba(255,255,255,0.2);font-size:22px;font-weight:800;color:white;letter-spacing:-1px;">${empresa.charAt(0).toUpperCase()}</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bienvenido a ${empresa}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f1f5f9;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:${colorSidebar};border-radius:16px 16px 0 0;padding:36px 40px;text-align:center;">
              <div style="margin-bottom:20px;">
                ${logoHtml}
              </div>
              <h1 style="margin:0 0 8px;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">
                ¡Bienvenido/a a ${empresa}!
              </h1>
              <p style="margin:0;color:rgba(255,255,255,0.65);font-size:14px;">
                El equipo de administración ha creado tu cuenta.
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px;">

              <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0f172a;">
                Hola, ${nombre} ${apellidos} 👋
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;">
                Tu cuenta en <strong style="color:#0f172a;">${empresa}</strong> ha sido creada con el rol de
                <strong style="color:#0f172a;">${rolLabel}</strong>. Para activarla, crea tu contraseña haciendo clic en el botón de abajo.
              </p>

              <!-- Info card -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:28px;overflow:hidden;">
                <tr>
                  <td style="background:${colorPrimario};padding:10px 20px;">
                    <p style="margin:0;font-size:11px;font-weight:700;color:rgba(255,255,255,0.85);text-transform:uppercase;letter-spacing:1px;">
                      Datos de tu cuenta
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Usuario (email)</p>
                    <p style="margin:0;font-size:15px;font-weight:600;color:#0f172a;font-family:monospace;">${email}</p>
                  </td>
                </tr>
              </table>

              <!-- Expiry notice -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="background:rgba(${priRgb},0.06);border-left:3px solid ${colorPrimario};border-radius:0 8px 8px 0;margin-bottom:32px;">
                <tr>
                  <td style="padding:12px 16px;">
                    <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">
                      ⏰ <strong>Este enlace expira en 7 días.</strong> Si no puedes acceder, contacta con tu administrador.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center">
                    <a href="${setPasswordUrl}"
                      style="display:inline-block;background:${colorPrimario};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:10px;letter-spacing:0.2px;">
                      Crear mi contraseña →
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="background:#ffffff;padding:0 40px;">
              <div style="border-top:1px solid #e2e8f0;"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#ffffff;padding:24px 40px 32px;border-radius:0 0 16px 16px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">
                Este email ha sido enviado automáticamente por <strong>${empresa}</strong>.
              </p>
              <p style="margin:0;font-size:12px;color:#cbd5e1;">
                Si no esperabas este mensaje, puedes ignorarlo.
              </p>
            </td>
          </tr>

          <tr><td style="height:24px;"></td></tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function getRolLabel(rol: string): string {
  switch (rol) {
    case "OWNER": return "Administrador";
    case "MANAGER": return "Coordinador";
    default: return "Empleado";
  }
}

export function bienvenidaTemplate(params: BienvenidaParams): string {
  const {
    nombre,
    apellidos,
    email,
    password,
    rol,
    empresa,
    colorPrimario,
    colorSidebar,
    logo,
    appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000",
  } = params;

  const rolLabel = getRolLabel(rol);
  const priRgb = hexToRgb(colorPrimario);

  const logoHtml = logo
    ? `<img src="${logo}" alt="${empresa}" style="max-height:48px;max-width:180px;object-fit:contain;" />`
    : `<div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;background:rgba(255,255,255,0.2);font-size:22px;font-weight:800;color:white;letter-spacing:-1px;">${empresa.charAt(0).toUpperCase()}</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bienvenido a ${empresa}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f1f5f9;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

          <!-- ── Header ───────────────────────────────────────────────── -->
          <tr>
            <td style="background:${colorSidebar};border-radius:16px 16px 0 0;padding:36px 40px;text-align:center;">
              <div style="margin-bottom:20px;">
                ${logoHtml}
              </div>
              <h1 style="margin:0 0 8px;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">
                ¡Bienvenido a ${empresa}!
              </h1>
              <p style="margin:0;color:rgba(255,255,255,0.65);font-size:14px;">
                Tu cuenta está lista. Ya puedes empezar.
              </p>
            </td>
          </tr>

          <!-- ── Body ─────────────────────────────────────────────────── -->
          <tr>
            <td style="background:#ffffff;padding:40px;">

              <!-- Greeting -->
              <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0f172a;">
                Hola, ${nombre} ${apellidos} 👋
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;">
                El equipo de administración ha creado tu cuenta con el rol de
                <strong style="color:#0f172a;">${rolLabel}</strong>.
                A continuación encontrarás tus credenciales de acceso.
              </p>

              <!-- Credentials card -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:28px;overflow:hidden;">
                <tr>
                  <td style="background:${colorPrimario};padding:10px 20px;">
                    <p style="margin:0;font-size:11px;font-weight:700;color:rgba(255,255,255,0.85);text-transform:uppercase;letter-spacing:1px;">
                      Credenciales de acceso
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td style="padding-bottom:12px;">
                          <p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Usuario (email)</p>
                          <p style="margin:0;font-size:15px;font-weight:600;color:#0f172a;font-family:monospace;">${email}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="border-top:1px solid #e2e8f0;padding-top:12px;">
                          <p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Contraseña temporal</p>
                          <p style="margin:0;font-size:15px;font-weight:700;color:#0f172a;font-family:monospace;letter-spacing:1px;">${password}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Security notice -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="background:rgba(${priRgb},0.06);border-left:3px solid ${colorPrimario};border-radius:0 8px 8px 0;margin-bottom:32px;">
                <tr>
                  <td style="padding:12px 16px;">
                    <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">
                      🔒 <strong>Importante:</strong> Por seguridad, te recomendamos cambiar tu contraseña en cuanto accedas por primera vez.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center">
                    <a href="${appUrl}/login"
                      style="display:inline-block;background:${colorPrimario};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:10px;letter-spacing:0.2px;">
                      Acceder a la plataforma →
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- ── Divider ───────────────────────────────────────────────── -->
          <tr>
            <td style="background:#ffffff;padding:0 40px;">
              <div style="border-top:1px solid #e2e8f0;"></div>
            </td>
          </tr>

          <!-- ── Footer ───────────────────────────────────────────────── -->
          <tr>
            <td style="background:#ffffff;padding:24px 40px 32px;border-radius:0 0 16px 16px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">
                Este email ha sido enviado automáticamente por <strong>${empresa}</strong>.
              </p>
              <p style="margin:0;font-size:12px;color:#cbd5e1;">
                Si no esperabas este mensaje, puedes ignorarlo.
              </p>
            </td>
          </tr>

          <!-- ── Bottom spacer ─────────────────────────────────────────── -->
          <tr>
            <td style="height:24px;"></td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

// ─── Ausencias ───────────────────────────────────────────────────────────────

interface AusenciaEmailParams {
  destinatarioNombre: string;
  empleadoNombre: string;
  tipo: string;
  fechaInicio: Date;
  fechaFin: Date;
  dias: number;
  motivo?: string | null;
  comentarioAdmin?: string | null;
  estado?: "PENDIENTE" | "APROBADA" | "RECHAZADA";
  empresa: string;
  colorPrimario: string;
  colorSidebar: string;
  logo?: string | null;
  appUrl?: string;
}

function fmtFecha(d: Date): string {
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

function shellLayout(args: {
  empresa: string;
  colorPrimario: string;
  colorSidebar: string;
  logo?: string | null;
  headerTitulo: string;
  headerSubtitulo: string;
  body: string;
  cta?: { label: string; url: string };
}): string {
  const { empresa, colorPrimario, colorSidebar, logo, headerTitulo, headerSubtitulo, body, cta } = args;
  const logoHtml = logo
    ? `<img src="${logo}" alt="${empresa}" style="max-height:48px;max-width:180px;object-fit:contain;" />`
    : `<div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:12px;background:rgba(255,255,255,0.2);font-size:22px;font-weight:800;color:white;letter-spacing:-1px;">${empresa.charAt(0).toUpperCase()}</div>`;
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${headerTitulo}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">
        <tr>
          <td style="background:${colorSidebar};border-radius:16px 16px 0 0;padding:36px 40px;text-align:center;">
            <div style="margin-bottom:20px;">${logoHtml}</div>
            <h1 style="margin:0 0 8px;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">${headerTitulo}</h1>
            <p style="margin:0;color:rgba(255,255,255,0.65);font-size:14px;">${headerSubtitulo}</p>
          </td>
        </tr>
        <tr><td style="background:#ffffff;padding:40px;">${body}${
          cta
            ? `
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:28px;">
                <tr><td align="center">
                  <a href="${cta.url}" style="display:inline-block;background:${colorPrimario};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:10px;letter-spacing:0.2px;">${cta.label} →</a>
                </td></tr>
              </table>`
            : ""
        }</td></tr>
        <tr><td style="background:#ffffff;padding:0 40px;"><div style="border-top:1px solid #e2e8f0;"></div></td></tr>
        <tr>
          <td style="background:#ffffff;padding:24px 40px 32px;border-radius:0 0 16px 16px;text-align:center;">
            <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">Email automático enviado por <strong>${empresa}</strong>.</p>
            <p style="margin:0;font-size:12px;color:#cbd5e1;">No respondas a este mensaje.</p>
          </td>
        </tr>
        <tr><td style="height:24px;"></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ausenciaCard(args: {
  colorPrimario: string;
  tipo: string;
  fechaInicio: Date;
  fechaFin: Date;
  dias: number;
  motivo?: string | null;
  comentarioAdmin?: string | null;
}): string {
  const { colorPrimario, tipo, fechaInicio, fechaFin, dias, motivo, comentarioAdmin } = args;
  const row = (k: string, v: string) => `
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#64748b;width:40%;">${k}</td>
      <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:600;">${v}</td>
    </tr>`;
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
      style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-top:8px;overflow:hidden;">
      <tr>
        <td style="background:${colorPrimario};padding:10px 20px;">
          <p style="margin:0;font-size:11px;font-weight:700;color:rgba(255,255,255,0.85);text-transform:uppercase;letter-spacing:1px;">Detalles de la solicitud</p>
        </td>
      </tr>
      <tr><td style="padding:8px 20px 14px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          ${row("Tipo", escapeHtml(tipo))}
          ${row("Desde", fmtFecha(fechaInicio))}
          ${row("Hasta", fmtFecha(fechaFin))}
          ${row("Días", String(dias))}
          ${motivo ? row("Motivo", escapeHtml(motivo)) : ""}
          ${comentarioAdmin ? row("Comentario", escapeHtml(comentarioAdmin)) : ""}
        </table>
      </td></tr>
    </table>`;
}

export function ausenciaCreadaTemplate(p: AusenciaEmailParams): string {
  const url = (p.appUrl ?? process.env.NEXTAUTH_URL ?? "") + "/admin/ausencias";
  const body = `
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0f172a;">Hola, ${escapeHtml(p.destinatarioNombre)} 👋</p>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">
      <strong style="color:#0f172a;">${escapeHtml(p.empleadoNombre)}</strong> ha solicitado una ausencia y está pendiente de aprobación.
    </p>
    ${ausenciaCard(p)}`;
  return shellLayout({
    empresa: p.empresa,
    colorPrimario: p.colorPrimario,
    colorSidebar: p.colorSidebar,
    logo: p.logo,
    headerTitulo: "Nueva solicitud de ausencia",
    headerSubtitulo: `Pendiente de revisión por el equipo`,
    body,
    cta: { label: "Revisar solicitud", url },
  });
}

interface ResetPasswordParams {
  nombre: string;
  apellidos: string;
  empresa: string;
  colorPrimario: string;
  colorSidebar: string;
  logo?: string | null;
  resetUrl: string;
}

export function resetPasswordTemplate(p: ResetPasswordParams): string {
  const body = `
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0f172a;">
      Hola, ${escapeHtml(p.nombre)} ${escapeHtml(p.apellidos)} 👋
    </p>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
      Has solicitado restablecer tu contraseña en <strong style="color:#0f172a;">${escapeHtml(p.empresa)}</strong>.
      Haz clic en el botón para crear una nueva contraseña.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
      style="background:rgba(245,158,11,0.06);border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;margin-bottom:8px;">
      <tr>
        <td style="padding:12px 16px;">
          <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">
            ⏰ <strong>Este enlace caduca en 1 hora.</strong> Si no fuiste tú quien lo solicitó, ignora este mensaje — tu contraseña no se cambiará.
          </p>
        </td>
      </tr>
    </table>`;
  return shellLayout({
    empresa: p.empresa,
    colorPrimario: p.colorPrimario,
    colorSidebar: p.colorSidebar,
    logo: p.logo,
    headerTitulo: "Restablece tu contraseña",
    headerSubtitulo: "Crea una nueva contraseña para tu cuenta",
    body,
    cta: { label: "Restablecer contraseña", url: p.resetUrl },
  });
}

// ─── Fichajes fuera de la sede ───────────────────────────────────────────────

interface FichajeFueraSedeParams {
  destinatarioNombre: string;
  empleadoNombre: string;
  /** ENTRADA | SALIDA | PAUSA | VUELTA_PAUSA, ya en texto legible. */
  tipo: string;
  timestamp: Date;
  /** Distancia real a la sede, en metros (calculada en servidor). */
  distancia: number;
  /** Radio permitido de la sede, en metros. */
  radio: number;
  sedeNombre: string;
  latitud: number | null;
  longitud: number | null;
  empresa: string;
  colorPrimario: string;
  colorSidebar: string;
  logo?: string | null;
  appUrl?: string;
}

function fmtFechaHora(d: Date): string {
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 850 → "850 m"; 1240 → "1,2 km". */
export function fmtDistancia(m: number): string {
  return m >= 1000
    ? `${(m / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km`
    : `${Math.round(m)} m`;
}

export function fichajeFueraSedeTemplate(p: FichajeFueraSedeParams): string {
  const base = p.appUrl ?? process.env.NEXTAUTH_URL ?? "";
  const url = `${base}/admin/informes`;
  const mapa =
    p.latitud != null && p.longitud != null
      ? `https://www.google.com/maps?q=${p.latitud},${p.longitud}`
      : null;

  const row = (k: string, v: string) => `
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#64748b;width:40%;">${k}</td>
      <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:600;">${v}</td>
    </tr>`;

  const body = `
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0f172a;">Hola, ${escapeHtml(p.destinatarioNombre)} 👋</p>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">
      <strong style="color:#0f172a;">${escapeHtml(p.empleadoNombre)}</strong> ha fichado a
      <strong style="color:#d97706;">${fmtDistancia(p.distancia)}</strong> de
      <strong style="color:#0f172a;">${escapeHtml(p.sedeNombre)}</strong>, fuera del radio
      de ${fmtDistancia(p.radio)} configurado para esa sede.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
      style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-top:8px;overflow:hidden;">
      <tr>
        <td style="background:${p.colorPrimario};padding:10px 20px;">
          <p style="margin:0;font-size:11px;font-weight:700;color:rgba(255,255,255,0.85);text-transform:uppercase;letter-spacing:1px;">Detalles del fichaje</p>
        </td>
      </tr>
      <tr><td style="padding:8px 20px 14px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          ${row("Empleado", escapeHtml(p.empleadoNombre))}
          ${row("Tipo", escapeHtml(p.tipo))}
          ${row("Fecha y hora", fmtFechaHora(p.timestamp))}
          ${row("Sede", escapeHtml(p.sedeNombre))}
          ${row("Distancia", `${fmtDistancia(p.distancia)} (radio: ${fmtDistancia(p.radio)})`)}
          ${mapa ? row("Ubicación", `<a href="${mapa}" style="color:${p.colorPrimario};">Ver en mapa</a>`) : ""}
        </table>
      </td></tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
      El fichaje se ha registrado correctamente: la ley (RD 8/2019) no permite bloquear
      el registro de jornada por la ubicación. Este correo es solo un aviso para que
      puedas revisarlo.
    </p>`;

  return shellLayout({
    empresa: p.empresa,
    colorPrimario: p.colorPrimario,
    colorSidebar: p.colorSidebar,
    logo: p.logo,
    headerTitulo: "Fichaje fuera de la sede",
    headerSubtitulo: `${escapeHtml(p.empleadoNombre)} ha fichado a ${fmtDistancia(p.distancia)} de su puesto`,
    body,
    cta: { label: "Ver en Informes", url },
  });
}

export function ausenciaResueltaTemplate(p: AusenciaEmailParams): string {
  const aprobada = p.estado === "APROBADA";
  const titulo = aprobada ? "Solicitud aprobada" : "Solicitud rechazada";
  const subtitulo = aprobada
    ? "Tu día queda registrado en el calendario."
    : "Consulta el comentario del responsable.";
  const body = `
    <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0f172a;">Hola, ${escapeHtml(p.destinatarioNombre)} 👋</p>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">
      Tu solicitud de ausencia ha sido
      <strong style="color:${aprobada ? "#059669" : "#dc2626"};">${aprobada ? "aprobada" : "rechazada"}</strong>.
    </p>
    ${ausenciaCard(p)}`;
  return shellLayout({
    empresa: p.empresa,
    colorPrimario: p.colorPrimario,
    colorSidebar: p.colorSidebar,
    logo: p.logo,
    headerTitulo: titulo,
    headerSubtitulo: subtitulo,
    body,
  });
}
