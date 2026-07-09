/**
 * Email al empleado cuando el equipo le sube/envía un documento (nómina,
 * contrato, adjunto…). Se envía solo si la empresa tiene activada la opción
 * "Documentos" en Configuración → Notificaciones (config.notifDocumentos).
 */

interface Args {
  destinatarioNombre: string;
  remitenteNombre: string;
  documentoNombre: string;
  empresa: string;
  documentosUrl: string;
}

export function documentoSubidoTemplate({
  destinatarioNombre,
  remitenteNombre,
  documentoNombre,
  empresa,
  documentosUrl,
}: Args): string {
  const safe = (s: string) => s.replace(/[<>]/g, "");

  return `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <h1 style="font-size:20px;color:#0f172a;margin:0 0 8px">Hola ${safe(destinatarioNombre)},</h1>
    <p style="color:#475569;font-size:14px;line-height:1.6">
      <strong>${safe(remitenteNombre)}</strong> de <strong>${safe(empresa)}</strong> te ha subido un documento:
    </p>
    <p style="font-size:16px;color:#0f172a;font-weight:600;margin:16px 0">${safe(documentoNombre)}</p>
    <a href="${documentosUrl}" style="display:inline-block;margin-top:12px;padding:12px 24px;background:#6366f1;color:white;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">Ver mis documentos</a>
    <p style="margin-top:32px;color:#94a3b8;font-size:12px">
      Puedes consultar y descargar tus documentos desde la app, en la sección "Mis Documentos".
    </p>
  </div>
</body></html>`;
}
