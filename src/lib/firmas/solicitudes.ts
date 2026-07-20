/**
 * Lógica compartida para crear una `SolicitudFirma` y avisar al destinatario.
 *
 * La usan dos handlers del mismo proceso —`POST /api/solicitudes-firma`
 * (solicitud manual del OWNER) y `POST /api/documentos` (firma obligatoria de
 * la carpeta de contratos / botón "solicitar firma" al subir)—, así que vive
 * aquí como función pura en `src/lib` en lugar de resolverse con un `fetch`
 * interno entre rutas (prohibido, ver AGENTS.md).
 *
 * Server-only: usa `prismaApp` (multiplexado por tenant) y envío de email; debe
 * invocarse dentro de un `runWithTenant` (lo garantizan `withTenant` /
 * `withTenantPage` de los callers).
 */

import { prismaApp } from "@/lib/prisma";
import { currentTenant } from "@/lib/tenant/context";
import { sendSystemEmail } from "@/lib/email";
import { solicitudFirmaTemplate } from "@/lib/email-templates/solicitud-firma";
import { tenantBaseUrl } from "@/lib/tenant/urls";

export interface CrearSolicitudFirmaInput {
  documentoId: string;
  destinatarioId: string;
  solicitadaPorId: string;
  mensaje?: string | null;
  expiraEn?: Date | null;
}

/**
 * Crea la `SolicitudFirma` y envía el aviso por email al destinatario
 * (fire-and-forget: un fallo de email no aborta la creación). Devuelve la
 * solicitud creada con las relaciones básicas.
 */
export async function crearSolicitudFirma(input: CrearSolicitudFirmaInput) {
  const solicitud = await prismaApp.solicitudFirma.create({
    data: {
      documentoId: input.documentoId,
      destinatarioId: input.destinatarioId,
      solicitadaPorId: input.solicitadaPorId,
      mensaje: input.mensaje ?? undefined,
      expiraEn: input.expiraEn ?? null,
    },
    include: {
      destinatario: { select: { email: true, nombre: true, apellidos: true } },
      solicitadaPor: { select: { nombre: true, apellidos: true } },
      documento: { select: { nombre: true } },
    },
  });

  // Email al destinatario con link a /empleado/firmas/[id].
  try {
    const config = await prismaApp.configuracionEmpresa.findFirst({
      select: { nombre: true, appNombre: true },
    });
    const empresa = config?.nombre ?? config?.appNombre ?? "tu empresa";
    const firmarUrl = `${tenantBaseUrl(currentTenant().slug)}/empleado/firmas/${solicitud.id}`;
    const html = solicitudFirmaTemplate({
      destinatarioNombre: solicitud.destinatario.nombre,
      solicitanteNombre: `${solicitud.solicitadaPor.nombre} ${solicitud.solicitadaPor.apellidos}`,
      documentoNombre: solicitud.documento.nombre,
      empresa,
      mensaje: solicitud.mensaje,
      expiraEn: solicitud.expiraEn,
      firmarUrl,
    });
    await sendSystemEmail(
      solicitud.destinatario.email,
      `Tienes un documento para firmar: ${solicitud.documento.nombre}`,
      html,
    );
  } catch (err) {
    console.error("[crearSolicitudFirma] fallo email:", err);
  }

  return solicitud;
}
