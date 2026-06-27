import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { prismaApp } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { sendSystemEmail } from "@/lib/email";
import {
  candidatoEstadoTemplate,
  candidatoEstadoSubject,
} from "@/lib/email-templates/candidato-estado";

const ESTADOS = [
  "recibido",
  "preseleccionado",
  "entrevista",
  "oferta_enviada",
  "contratado",
  "rechazado",
] as const;

const patchSchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  notas: z.string().max(2000).optional(),
});

export const PATCH = withTenant(withFeature("reclutamiento", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const session = await auth();
  const user = session?.user as { rol?: Rol | string } | undefined;
  if (user?.rol !== Rol.OWNER && user?.rol !== Rol.MANAGER) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
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
  // Capturamos estado anterior para detectar cambio.
  const before = await prismaApp.candidato.findUnique({
    where: { id },
    select: { estado: true },
  });

  const candidato = await prismaApp.candidato.update({
    where: { id },
    data: parsed.data,
    include: { oferta: { select: { titulo: true } } },
  });

  // Email automático si el estado cambió a uno notificable.
  if (parsed.data.estado && before && before.estado !== parsed.data.estado) {
    const subject = candidatoEstadoSubject(parsed.data.estado, candidato.oferta.titulo, "");
    if (subject) {
      try {
        const config = await prismaApp.configuracionEmpresa.findFirst({
          select: { nombre: true, appNombre: true },
        });
        const empresa = config?.nombre ?? config?.appNombre ?? "la empresa";
        const html = candidatoEstadoTemplate({
          nombre: candidato.nombre,
          apellidos: candidato.apellidos,
          ofertaTitulo: candidato.oferta.titulo,
          empresa,
          estado: parsed.data.estado,
        });
        if (html) {
          const finalSubject = candidatoEstadoSubject(
            parsed.data.estado,
            candidato.oferta.titulo,
            empresa,
          );
          await sendSystemEmail(candidato.email, finalSubject ?? subject, html);
        }
      } catch (err) {
        console.error("[candidato PATCH] fallo email:", err);
      }
    }
  }

  return NextResponse.json({ candidato });
}));
