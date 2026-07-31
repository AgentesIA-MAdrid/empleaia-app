import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { isSafeDocUrl } from "@/lib/documentos/url";
import { esCarpetaFirmaObligatoria } from "@/lib/documentos/categorias";
import { crearSolicitudFirma } from "@/lib/firmas/solicitudes";
import { currentTenant } from "@/lib/tenant/context";
import { sendSystemEmail } from "@/lib/email";
import { documentoSubidoTemplate } from "@/lib/email-templates/documento-subido";
import { tenantBaseUrl } from "@/lib/tenant/urls";

// Límite del fichero cuando se sube como data URL (se guarda en `url`, texto en
// BD). ~7MB de cadena base64 ≈ ~5MB de fichero. Suficiente para nóminas/PDF.
const MAX_URL_LEN = 7_000_000;

export const GET = withTenant(withFeature("documentos", async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = (session.user as any).id as string;
    const rol = (session.user as any).rol as string;

    // EMPLEADO: solo los suyos. OWNER/MANAGER: todos, o los de un empleado
    // concreto si viene ?userId= (para la pestaña de la ficha del empleado).
    const filtroUserId = req.nextUrl.searchParams.get("userId");
    const where =
      rol === "EMPLEADO"
        ? { userId }
        : filtroUserId
          ? { userId: filtroUserId }
          : {};

    const documentos = await prisma.documento.findMany({
      where,
      include: {
        user: { select: { nombre: true, apellidos: true } },
        subidoPor: { select: { nombre: true, apellidos: true } },
        solicitudesFirma: { select: { id: true, estado: true, destinatarioId: true } },
        firmas: { select: { id: true, userId: true, firmadoEn: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Qué documentos tienen una copia SELLADA firmada por quien mira. Se
    // pregunta aparte y sin traer el PDF: la copia sellada es un data URL de
    // cientos de KB y aquí solo hace falta saber si existe (ticket 6b0f74d2).
    //
    // Con eso, el empleado que ya ha firmado descarga su copia firmada y deja
    // de ver la preliminar: tener las dos a la vista invita a guardar y reenviar
    // la que no vale.
    const firmadosPorMi = new Set(
      (
        await prisma.firma.findMany({
          where: {
            userId,
            documentoFirmadoUrl: { not: null },
            documentoId: { in: documentos.map((d) => d.id) },
          },
          select: { documentoId: true },
        })
      ).map((f) => f.documentoId),
    );

    return NextResponse.json({
      documentos: documentos.map((d) => ({ ...d, firmadoPorMi: firmadosPorMi.has(d.id) })),
    });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));

export const POST = withTenant(withFeature("documentos", async (req: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const rol = (session.user as any).rol as string;
    const meId = (session.user as any).id as string;

    const body = await req.json();
    const { nombre, descripcion, url, tipo, userId, solicitarFirma } = body;
    if (!nombre) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    if (typeof url === "string" && url.length > MAX_URL_LEN) {
      return NextResponse.json({ error: "El archivo es demasiado grande (máx ~5 MB)." }, { status: 400 });
    }
    // Blindaje XSS: solo https, ruta same-origin, o data URL de PDF/imagen
    // rasterizada. Rechaza javascript:, data:text/html, data:image/svg+xml…
    if (url && !isSafeDocUrl(url)) {
      return NextResponse.json({ error: "Tipo de archivo/URL no permitido." }, { status: 400 });
    }

    // EMPLEADO: solo puede adjuntar documentos PARA SÍ MISMO (userId forzado a
    // su propio id). OWNER/MANAGER: pueden enviar documentos a cualquier
    // empleado (userId del body) o generales (null).
    const destinatarioId = rol === "EMPLEADO" ? meId : (userId || null);

    // Firma. La carpeta "Contratos laborales y anexos" exige firma OBLIGATORIA
    // de todo documento que se sube en ella; en el resto de carpetas es opcional
    // (botón "solicitar firma" al enviar). Solo la gestión (OWNER/MANAGER) puede
    // solicitar firma; un EMPLEADO subiendo un doc propio nunca la dispara.
    const puedeSolicitar = rol === "OWNER" || rol === "MANAGER";
    const firmaObligatoria = esCarpetaFirmaObligatoria(tipo);
    const firmaRequerida = puedeSolicitar && (firmaObligatoria || solicitarFirma === true);
    if (firmaRequerida) {
      if (!destinatarioId) {
        return NextResponse.json(
          { error: "Para solicitar la firma, elige el empleado destinatario del documento." },
          { status: 400 },
        );
      }
      if (!isSafeDocUrl(url)) {
        return NextResponse.json(
          {
            error: firmaObligatoria
              ? "Los documentos de «Contratos laborales y anexos» necesitan un archivo adjunto para que el empleado pueda firmarlo."
              : "Adjunta el archivo del documento para poder solicitar su firma.",
          },
          { status: 400 },
        );
      }
    }

    const documento = await prisma.documento.create({
      data: {
        nombre,
        descripcion: descripcion || null,
        url: url || null,
        tipo: tipo || "otro",
        userId: destinatarioId,
        subidoPorId: meId,
      },
      include: {
        user: { select: { nombre: true, apellidos: true, email: true } },
        subidoPor: { select: { nombre: true, apellidos: true } },
      },
    });

    // Firma requerida (carpeta de contratos = obligatoria, o botón "solicitar
    // firma" en el resto de carpetas): se crea la SolicitudFirma y el empleado
    // recibe su propio aviso "tienes un documento para firmar". En ese caso NO
    // se manda además el aviso genérico de documento subido (sería duplicado).
    // Fire-and-forget: un fallo aquí no revierte la subida del documento.
    let firmaSolicitada = false;
    if (firmaRequerida && destinatarioId) {
      try {
        await crearSolicitudFirma({
          documentoId: documento.id,
          destinatarioId,
          solicitadaPorId: meId,
        });
        firmaSolicitada = true;
      } catch (err) {
        console.error("[documentos POST] fallo al crear solicitud de firma:", err);
      }
    }

    // Aviso por email al empleado, si la empresa lo tiene activado
    // (Configuración → Notificaciones → Documentos). Solo cuando el documento
    // va dirigido a un empleado distinto de quien lo sube y no se ha pedido
    // firma. Fire-and-forget: un fallo de email no rompe la subida.
    if (!firmaSolicitada && destinatarioId && destinatarioId !== meId && documento.user?.email) {
      try {
        const config = await prisma.configuracionEmpresa.findFirst({
          select: { notifDocumentos: true, nombre: true, appNombre: true },
        });
        if (config?.notifDocumentos !== false) {
          const empresa = config?.nombre ?? config?.appNombre ?? "tu empresa";
          const remitente = documento.subidoPor
            ? `${documento.subidoPor.nombre} ${documento.subidoPor.apellidos}`.trim()
            : "El equipo";
          const html = documentoSubidoTemplate({
            destinatarioNombre: documento.user.nombre,
            remitenteNombre: remitente,
            documentoNombre: documento.nombre,
            empresa,
            documentosUrl: `${tenantBaseUrl(currentTenant().slug)}/empleado/documentos`,
          });
          await sendSystemEmail(
            documento.user.email,
            `Tienes un nuevo documento: ${documento.nombre}`,
            html,
          );
        }
      } catch (err) {
        console.error("[documentos POST] fallo email:", err);
      }
    }

    return NextResponse.json({ documento, firmaSolicitada }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}));
