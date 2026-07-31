/**
 * Aviso por email cuando un empleado ficha fuera del radio de su sede.
 *
 * El fichaje NUNCA se rechaza por ubicación (RD 8/2019: el registro de
 * jornada siempre debe poder hacerse). Lo único que hacemos es avisar a
 * quien administra: OWNERs + managers de la sede del empleado.
 *
 * Se dispara desde `POST /api/fichajes` cuando la distancia calculada en
 * el servidor supera `Tienda.radio` (200 m por defecto).
 *
 * Respeta `ConfiguracionEmpresa.notifFueraSede`: si el OWNER lo apaga en
 * Configuración → Notificaciones, no se manda ningún correo. Best-effort:
 * los errores se loggean, no propagan y no rompen el fichaje.
 */

import { prismaApp as prisma } from "@/lib/prisma";
import { sendSystemEmail } from "@/lib/email";
import { Rol, TipoFichaje } from "@/generated/prisma-tenant/client";
import { fichajeFueraSedeTemplate, fmtDistancia } from "@/lib/email-templates";

export interface FichajeFueraSedeCtx {
  empleado: { id: string; nombre: string; apellidos: string };
  tipo: TipoFichaje;
  timestamp: Date;
  /** Distancia a la sede en metros — calculada en servidor, no por el cliente. */
  distancia: number;
  sede: { id: string; nombre: string; radio: number };
  latitud: number | null;
  longitud: number | null;
}

const TIPO_LABEL: Record<TipoFichaje, string> = {
  [TipoFichaje.ENTRADA]: "Entrada",
  [TipoFichaje.SALIDA]: "Salida",
  [TipoFichaje.PAUSA]: "Inicio de pausa",
  [TipoFichaje.VUELTA_PAUSA]: "Vuelta de pausa",
};

export async function notifyFichajeFueraSede(f: FichajeFueraSedeCtx): Promise<void> {
  try {
    const cfg = await prisma.configuracionEmpresa
      .findUnique({
        where: { id: "singleton" },
        select: {
          notifFueraSede: true,
          nombre: true,
          appNombre: true,
          colorPrimario: true,
          colorSidebar: true,
          logo: true,
          // Para escribir la hora del fichaje como la lee el cliente, no en la
          // del servidor (ticket 3c91f0ab).
          zonaHoraria: true,
        },
      })
      .catch(() => null);

    // Off explícito → no molestamos. Sin configuración todavía → avisamos
    // (el default de la columna es true).
    if (cfg?.notifFueraSede === false) return;

    const empresa = cfg?.nombre ?? cfg?.appNombre ?? "empleaIA";
    const colorPrimario = cfg?.colorPrimario ?? "#6366f1";
    const colorSidebar = cfg?.colorSidebar ?? "#1e1b4b";
    const logo = cfg?.logo ?? null;

    // Destinatarios: todos los OWNER + los managers de la sede del fichaje.
    const destinatarios = await prisma.user.findMany({
      where: {
        OR: [
          { rol: Rol.OWNER, activo: true },
          { rol: Rol.MANAGER, activo: true, tiendaId: f.sede.id },
        ],
      },
      select: { id: true, email: true, nombre: true },
    });

    const empleadoNombre = `${f.empleado.nombre} ${f.empleado.apellidos}`.trim();
    const subject = `Fichaje fuera de la sede — ${empleadoNombre} (${fmtDistancia(f.distancia)})`;

    await Promise.allSettled(
      destinatarios
        .filter((d) => d.id !== f.empleado.id && d.email)
        .map((d) =>
          sendSystemEmail(
            d.email,
            subject,
            fichajeFueraSedeTemplate({
              destinatarioNombre: d.nombre || "equipo",
              empleadoNombre,
              tipo: TIPO_LABEL[f.tipo] ?? f.tipo,
              timestamp: f.timestamp,
              distancia: f.distancia,
              radio: f.sede.radio,
              sedeNombre: f.sede.nombre,
              latitud: f.latitud,
              longitud: f.longitud,
              empresa,
              colorPrimario,
              colorSidebar,
              logo,
              zonaHoraria: cfg?.zonaHoraria ?? null,
            }),
          ),
        ),
    );
  } catch (err) {
    console.error("[notifyFichajeFueraSede]", err);
  }
}
