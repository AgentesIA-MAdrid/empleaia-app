/**
 * Plantillas de documentos — tipos compartidos + lógica de envío.
 *
 * Una `PlantillaDocumento` es un documento contractual reutilizable con los
 * campos que el empleado tendrá que rellenar marcados. Se envía a uno o varios
 * empleados desde dos sitios del mismo proceso:
 *   - `POST /api/documentos/plantillas/[id]/enviar` (botón "adjuntar plantilla"
 *     en el envío de documentos), y
 *   - `POST /api/empleados` (envío como parte del alta del empleado).
 *
 * Por eso la lógica de envío vive aquí como función pura en `src/lib` en vez de
 * resolverse con un `fetch` interno entre rutas (prohibido, ver AGENTS.md).
 *
 * Las definiciones de tipos (`CampoPlantilla`) son puras y también las usa la
 * UI; el resto es server-only (usa `prismaApp`, multiplexado por tenant, y debe
 * invocarse dentro de un `runWithTenant`, lo garantizan los callers).
 */

import { prismaApp } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma-tenant/client";
import { isSafeDocUrl } from "@/lib/documentos/url";
import { esCarpetaFirmaObligatoria } from "@/lib/documentos/categorias";
import { crearSolicitudFirma } from "@/lib/firmas/solicitudes";
import { normalizarCampos } from "@/lib/documentos/campos";

/** Datos mínimos de una plantilla necesarios para materializar un envío. */
export interface PlantillaEnviable {
  nombre: string;
  descripcion: string | null;
  url: string | null;
  tipo: string;
  campos: unknown;
  solicitarFirma: boolean;
}

export interface EnviarPlantillaInput {
  plantilla: PlantillaEnviable;
  destinatarioId: string;
  solicitadaPorId: string;
}

/**
 * Materializa el envío de una plantilla a un empleado: crea un `Documento` para
 * el destinatario copiando nombre, descripción, archivo, carpeta y campos. Si la
 * plantilla pide firma (o cae en la carpeta de contratos, que la exige) y tiene
 * archivo adjunto, crea además la `SolicitudFirma` (fire-and-forget en su email).
 *
 * Devuelve el documento creado y si se solicitó firma.
 */
export async function enviarPlantilla({
  plantilla,
  destinatarioId,
  solicitadaPorId,
}: EnviarPlantillaInput): Promise<{ documentoId: string; firmaSolicitada: boolean }> {
  const campos = normalizarCampos(plantilla.campos);
  const documento = await prismaApp.documento.create({
    data: {
      nombre: plantilla.nombre,
      descripcion: plantilla.descripcion ?? null,
      url: plantilla.url ?? null,
      tipo: plantilla.tipo || "otro",
      campos: campos as unknown as Prisma.InputJsonValue,
      userId: destinatarioId,
      subidoPorId: solicitadaPorId,
    },
    select: { id: true },
  });

  const firmaObligatoria = esCarpetaFirmaObligatoria(plantilla.tipo);
  const pedirFirma =
    (plantilla.solicitarFirma || firmaObligatoria) && isSafeDocUrl(plantilla.url);

  let firmaSolicitada = false;
  if (pedirFirma) {
    try {
      await crearSolicitudFirma({
        documentoId: documento.id,
        destinatarioId,
        solicitadaPorId,
      });
      firmaSolicitada = true;
    } catch (err) {
      console.error("[enviarPlantilla] fallo al crear solicitud de firma:", err);
    }
  }

  return { documentoId: documento.id, firmaSolicitada };
}
