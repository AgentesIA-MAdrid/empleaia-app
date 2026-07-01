/**
 * /api/denuncias/[id]
 *
 *   GET    → detalle (admin/asignado/informante via token)
 *   PATCH  → cambiar estado, asignar, registrar acuse o resolución
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { sendSystemEmail } from "@/lib/email";
import { denunciaEstadoTemplate } from "@/lib/email-templates/denuncia-estado";

const ESTADOS = [
  "recibida",
  "acuse_recibido",
  "en_investigacion",
  "resuelta",
  "archivada",
] as const;

const patchSchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  asignadoUserId: z.string().nullable().optional(),
  resolucionResumen: z.string().min(10).max(5000).optional(),
});

export const GET = withTenant(
  withFeature("canal_denuncias", async (
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    const user = session?.user as
      | { id?: string; rol?: Rol | string }
      | undefined;
    if (!user || !user.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const { id } = await params;
    const denuncia = await prismaApp.denuncia.findUnique({
      where: { id },
      include: {
        comentarios: { orderBy: { createdAt: "asc" } },
        informanteUser: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
        asignadoUser: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
      },
    });
    if (!denuncia) {
      return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    }

    const isAdmin = user.rol === Rol.OWNER || user.rol === Rol.MANAGER;
    const isAsignado = denuncia.asignadoUserId === user.id;
    const isInformante = denuncia.informanteUserId === user.id;
    if (!isAdmin && !isAsignado && !isInformante) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    // Filtra comentarios internos para no-staff (informante).
    const isStaff = isAdmin || isAsignado;
    const comentarios = isStaff
      ? denuncia.comentarios
      : denuncia.comentarios.filter((c) => !c.esInterno);

    return NextResponse.json({
      denuncia: { ...denuncia, comentarios, accessTokenHash: undefined },
    });
  }),
);

export const PATCH = withTenant(
  withFeature("canal_denuncias", async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await auth();
    const user = session?.user as
      | { id?: string; rol?: Rol | string }
      | undefined;
    if (!user || !user.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    // Gestionar denuncias (estado, asignación, resolución) es gestión:
    // solo el Administrador (OWNER). El Coordinador conserva la lectura.
    if (user.rol !== Rol.OWNER) {
      return NextResponse.json(
        { error: "Solo el Administrador puede gestionar denuncias" },
        { status: 403 },
      );
    }
    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body inválido" }, { status: 400 });
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const update: Record<string, unknown> = {};
    if (data.estado) {
      update.estado = data.estado;
      // Cuando se pasa a `acuse_recibido` por primera vez, sellamos timestamp.
      if (data.estado === "acuse_recibido") {
        update.acuseReciboAt = new Date();
      }
      // Cuando se resuelve, sellamos timestamp + resumen requerido.
      if (data.estado === "resuelta") {
        if (!data.resolucionResumen) {
          return NextResponse.json(
            { error: "Para resolver es obligatorio un resumen" },
            { status: 400 },
          );
        }
        update.resolucionAt = new Date();
        update.resolucionResumen = data.resolucionResumen;
      }
    }
    if (data.asignadoUserId !== undefined) {
      update.asignadoUserId = data.asignadoUserId;
    }

    const denuncia = await prismaApp.denuncia.update({
      where: { id },
      data: update,
    });

    // Email automático al informante si NO es anónima y cambió el estado.
    if (data.estado && denuncia.informanteEmail && !denuncia.esAnonima) {
      try {
        const config = await prismaApp.configuracionEmpresa.findFirst({
          select: { nombre: true, appNombre: true },
        });
        const empresa = config?.nombre ?? config?.appNombre ?? "tu empresa";
        const html = denunciaEstadoTemplate({
          asunto: denuncia.asunto,
          estadoNuevo: data.estado,
          empresa,
          resolucionResumen: denuncia.resolucionResumen,
        });
        await sendSystemEmail(
          denuncia.informanteEmail,
          `Tu denuncia "${denuncia.asunto}" — actualización de estado`,
          html,
        );
      } catch (err) {
        console.error("[denuncia PATCH] fallo email estado:", err);
      }
    }

    return NextResponse.json({ denuncia: { ...denuncia, accessTokenHash: undefined } });
  }),
);
