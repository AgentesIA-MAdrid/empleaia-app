/**
 * POST /api/solicitudes-firma/[id]/firmar
 *
 * Solo el destinatario de la solicitud puede firmarla. Para firmar teclea su
 * nombre y DNI/NIE y dibuja un garabato manuscrito. Se crea un registro
 * `Firma` con esos datos + hash del documento + IP + UserAgent, se estampa la
 * firma en el margen izquierdo de cada página del documento y se marca la
 * solicitud como `firmada`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { hashDocumento } from "@/lib/firmas/hash-documento";
import { estamparFirmaEnDocumento } from "@/lib/firmas/estampar";
import { normalizarDni, validarDni } from "@/lib/firmas/dni";

// El garabato viaja como data URL PNG/JPEG (dibujo del canvas). Cota de tamaño
// para no reventar la columna de BD (~1.5 MB de base64 ≈ trazo holgado).
const MAX_GARABATO_LEN = 1_500_000;
const GARABATO_RE = /^data:image\/(png|jpe?g);base64,/i;

export const POST = withTenant(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;

  let body: { nombre?: unknown; dni?: unknown; garabato?: unknown };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
  if (nombre.length < 3) {
    return NextResponse.json({ error: "Escribe tu nombre completo" }, { status: 400 });
  }
  if (!validarDni(body.dni)) {
    return NextResponse.json({ error: "El DNI/NIE no es válido" }, { status: 400 });
  }
  const dni = normalizarDni(body.dni as string);
  const garabato = typeof body.garabato === "string" ? body.garabato : "";
  if (!GARABATO_RE.test(garabato)) {
    return NextResponse.json({ error: "Falta el garabato de la firma" }, { status: 400 });
  }
  if (garabato.length > MAX_GARABATO_LEN) {
    return NextResponse.json({ error: "El garabato es demasiado grande" }, { status: 400 });
  }

  const solicitud = await prismaApp.solicitudFirma.findUnique({
    where: { id },
    include: {
      documento: { select: { id: true, nombre: true, url: true } },
      firma: { select: { id: true } },
    },
  });
  if (!solicitud) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }
  if (solicitud.destinatarioId !== user.id) {
    return NextResponse.json(
      { error: "Solo el destinatario puede firmar" },
      { status: 403 },
    );
  }
  if (solicitud.estado !== "pendiente") {
    return NextResponse.json(
      { error: `La solicitud está en estado ${solicitud.estado}` },
      { status: 409 },
    );
  }
  if (solicitud.expiraEn && solicitud.expiraEn < new Date()) {
    await prismaApp.solicitudFirma.update({
      where: { id },
      data: { estado: "expirada" },
    });
    return NextResponse.json({ error: "La solicitud ha expirado" }, { status: 410 });
  }

  // Sello probatorio: hash del contenido + identidad tecleada en el momento
  // de firmar.
  const documentHash = hashDocumento(
    `${solicitud.documento.id}|${solicitud.documento.nombre}|${solicitud.documento.url ?? ""}|${dni}`,
  );
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : null;
  const ua = req.headers.get("user-agent");
  const firmadoEn = new Date();

  // Estampa la firma en el margen izquierdo de cada hoja del documento. Si el
  // documento no es estampable (sin URL, remoto o tipo no soportado) la firma
  // se registra igual, sin copia sellada.
  let documentoFirmadoUrl: string | null = null;
  if (solicitud.documento.url) {
    try {
      documentoFirmadoUrl = await estamparFirmaEnDocumento({
        documentoUrl: solicitud.documento.url,
        garabatoUrl: garabato,
        nombre,
        dni,
        fecha: firmadoEn,
      });
    } catch (err) {
      console.error("[firmar] fallo al estampar el documento:", err);
    }
  }

  const [firma] = await prismaApp.$transaction([
    prismaApp.firma.create({
      data: {
        documentoId: solicitud.documentoId,
        userId: user.id,
        solicitudId: solicitud.id,
        documentHash,
        ip,
        userAgent: ua,
        firmadoEn,
        firmanteNombre: nombre,
        firmanteDni: dni,
        firmaImagen: garabato,
        documentoFirmadoUrl,
      },
    }),
    prismaApp.solicitudFirma.update({
      where: { id },
      data: { estado: "firmada" },
    }),
  ]);

  return NextResponse.json({ firma: { id: firma.id } }, { status: 201 });
});
