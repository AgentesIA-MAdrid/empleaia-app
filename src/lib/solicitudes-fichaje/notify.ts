/**
 * Notificaciones de las solicitudes de fichaje.
 *
 *   notifySolicitudCreada   → coordinador designado + OWNERs + MANAGERs de la
 *                             sede del solicitante (cuando se crea).
 *   notifySolicitudResuelta → empleado solicitante (cuando se aprueba/rechaza).
 *
 * Crea SIEMPRE la notificación in-app (es un flujo accionable, no ruido
 * pasivo como un fichaje normal) y manda email best-effort. Errores se
 * loguean, no propagan.
 */

import { prismaApp as prisma } from "@/lib/prisma";
import { sendSystemEmail } from "@/lib/email";
import { Rol } from "@/generated/prisma-tenant/client";
import type { TipoFichaje, EstadoSolicitudFichaje } from "@/generated/prisma-tenant/client";

export interface SolicitudCtx {
  id: string;
  clase: string;
  tipo: TipoFichaje;
  fechaHora: Date;
  motivo: string;
  estado: EstadoSolicitudFichaje;
  respuesta?: string | null;
  aprobadorId?: string | null;
  solicitante: {
    id: string;
    nombre: string;
    apellidos: string;
    email: string;
    tiendaId: string | null;
  };
}

interface Branding {
  empresa: string;
  colorPrimario: string;
  colorSidebar: string;
  logo: string | null;
}

/** Escapa texto para interpolarlo de forma segura en HTML de email. */
function esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

const TIPO_LABEL: Record<string, string> = {
  ENTRADA: "Entrada",
  PAUSA: "Pausa",
  VUELTA_PAUSA: "Vuelta de pausa",
  SALIDA: "Salida",
};

async function getBranding(): Promise<Branding> {
  try {
    const cfg = await prisma.configuracionEmpresa.findFirst({
      select: {
        nombre: true,
        appNombre: true,
        colorPrimario: true,
        colorSidebar: true,
        logo: true,
      },
    });
    return {
      empresa: cfg?.nombre ?? cfg?.appNombre ?? "empleaIA",
      colorPrimario: cfg?.colorPrimario ?? "#6366f1",
      colorSidebar: cfg?.colorSidebar ?? "#1e1b4b",
      logo: cfg?.logo ?? null,
    };
  } catch {
    return { empresa: "empleaIA", colorPrimario: "#6366f1", colorSidebar: "#1e1b4b", logo: null };
  }
}

function fmt(d: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function shell(b: Branding, titulo: string, cuerpo: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee;border-radius:12px;overflow:hidden">
    <div style="background:${esc(b.colorSidebar)};padding:20px 24px">
      ${b.logo ? `<img src="${esc(b.logo)}" alt="${esc(b.empresa)}" style="max-height:36px"/>` : `<span style="color:#fff;font-weight:700;font-size:18px">${esc(b.empresa)}</span>`}
    </div>
    <div style="padding:24px">
      <h2 style="color:${esc(b.colorPrimario)};margin:0 0 12px">${esc(titulo)}</h2>
      ${cuerpo}
    </div>
  </div>`;
}

/** Coordinador designado + OWNERs + MANAGERs de la sede del solicitante. */
async function destinatariosResolucion(s: SolicitudCtx) {
  const tiendaId = s.solicitante.tiendaId;
  const managerWhere = tiendaId
    ? { rol: Rol.MANAGER, activo: true, tiendaId }
    : { rol: Rol.MANAGER, activo: true };
  const where: Record<string, unknown> = {
    OR: [
      { rol: Rol.OWNER, activo: true },
      managerWhere,
      ...(s.aprobadorId ? [{ id: s.aprobadorId, activo: true }] : []),
    ],
  };
  const users = await prisma.user.findMany({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where: where as any,
    select: { id: true, nombre: true, email: true },
  });
  return users.filter((u) => u.id !== s.solicitante.id);
}

export async function notifySolicitudCreada(s: SolicitudCtx): Promise<void> {
  try {
    const b = await getBranding();
    const recipientes = await destinatariosResolucion(s);
    const empleado = `${s.solicitante.nombre} ${s.solicitante.apellidos}`.trim();
    const tipoTxt = TIPO_LABEL[s.tipo] ?? s.tipo;
    const accion = s.clase === "correccion" ? "corregir" : "registrar";
    const titulo = "Nueva solicitud de fichaje";
    const mensaje = `${empleado} pide ${accion} un fichaje de ${tipoTxt} (${fmt(s.fechaHora)}).`;
    const enlace = "/admin/solicitudes-fichaje";

    // In-app para cada destinatario.
    await prisma.notificacion.createMany({
      data: recipientes.map((r) => ({
        userId: r.id,
        titulo,
        mensaje,
        tipo: "solicitud_fichaje",
        enlace,
      })),
    });

    // Email best-effort.
    const html = shell(
      b,
      titulo,
      `<p>${esc(mensaje)}</p>
       <p style="color:#555"><strong>Motivo:</strong> ${esc(s.motivo)}</p>
       <p><a href="${esc(enlace)}" style="color:${esc(b.colorPrimario)}">Revisar la solicitud</a></p>`,
    );
    await Promise.allSettled(
      recipientes
        .filter((r) => r.email)
        .map((r) => sendSystemEmail(r.email!, `${titulo} — ${empleado}`, html)),
    );
  } catch (err) {
    console.error("[notifySolicitudCreada]", err);
  }
}

export async function notifySolicitudResuelta(s: SolicitudCtx): Promise<void> {
  try {
    if (s.estado !== "APROBADA" && s.estado !== "RECHAZADA") return;
    if (!s.solicitante.email) return;
    const b = await getBranding();
    const aprobada = s.estado === "APROBADA";
    const tipoTxt = TIPO_LABEL[s.tipo] ?? s.tipo;
    const titulo = aprobada
      ? "Tu solicitud de fichaje ha sido aprobada"
      : "Tu solicitud de fichaje ha sido rechazada";
    const mensaje = `Solicitud de ${tipoTxt} (${fmt(s.fechaHora)}): ${aprobada ? "aprobada" : "rechazada"}.`;

    await prisma.notificacion.create({
      data: {
        userId: s.solicitante.id,
        titulo,
        mensaje,
        tipo: aprobada ? "solicitud_fichaje_aprobada" : "solicitud_fichaje_rechazada",
        enlace: "/empleado/mis-fichajes",
      },
    });

    const html = shell(
      b,
      titulo,
      `<p>${esc(mensaje)}</p>
       ${s.respuesta ? `<p style="color:#555"><strong>Comentario:</strong> ${esc(s.respuesta)}</p>` : ""}`,
    );
    await sendSystemEmail(s.solicitante.email, titulo, html);
  } catch (err) {
    console.error("[notifySolicitudResuelta]", err);
  }
}
