/**
 * Aviso de "olvido de fichaje": detecta empleados con un turno PUBLICADO
 * cuyo inicio ya pasó (con margen de gracia) y que NO han fichado la entrada
 * del día, y avisa al empleado y a su coordinador (in-app + email).
 *
 * Detección por turno asignado (cuadrante). Se marca `avisoFichajeEnviadoAt`
 * para no repetir el aviso en cada pasada del cron.
 *
 * La lógica de decisión (`turnosOlvidados`) es pura y testeable; el resto
 * recibe `prismaApp` del tenant activo.
 */

import type { PrismaClient } from "@/generated/prisma-tenant/client";
import { sendSystemEmail } from "@/lib/email";

export const GRACIA_MIN_DEFAULT = 15;

export function hhmmToMin(s: string): number {
  const [h, m] = (s || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Fecha (YYYY-MM-DD) y minutos del día en zona Europe/Madrid para un instante. */
export function madridParts(d: Date): { fecha: string; minutos: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    minutos: Number(p.hour) * 60 + Number(p.minute),
  };
}

export interface TurnoEval {
  id: string;
  userId: string;
  horaInicio: string;
  horaFin: string;
}

/**
 * De los turnos candidatos, devuelve los "olvidados": el empleado no ha
 * fichado entrada hoy y ahora estamos entre (inicio + gracia) y fin del turno.
 */
export function turnosOlvidados(opts: {
  turnos: TurnoEval[];
  entradasUserIds: Set<string>;
  nowMinutos: number;
  graciaMin: number;
}): TurnoEval[] {
  return opts.turnos.filter((t) => {
    if (opts.entradasUserIds.has(t.userId)) return false;
    const ini = hhmmToMin(t.horaInicio);
    const fin = hhmmToMin(t.horaFin);
    return opts.nowMinutos >= ini + opts.graciaMin && opts.nowMinutos <= fin;
  });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** Ejecuta la detección + avisos para el tenant activo. Devuelve un resumen. */
export async function detectarOlvidosFichaje(
  prisma: PrismaClient,
  ahora: Date = new Date(),
  graciaMin: number = GRACIA_MIN_DEFAULT,
): Promise<{ revisados: number; avisados: number }> {
  const { fecha: hoy, minutos: nowMin } = madridParts(ahora);

  // Ventana amplia alrededor de hoy (independiente de cómo se guardó `fecha`).
  const ventanaIni = new Date(ahora.getTime() - 30 * 3_600_000);
  const ventanaFin = new Date(ahora.getTime() + 30 * 3_600_000);

  const candidatos = await prisma.turno.findMany({
    where: {
      estado: "PUBLICADO",
      avisoFichajeEnviadoAt: null,
      fecha: { gte: ventanaIni, lte: ventanaFin },
    },
    select: {
      id: true,
      userId: true,
      horaInicio: true,
      horaFin: true,
      fecha: true,
      tienda: { select: { nombre: true } },
      user: {
        select: { id: true, nombre: true, apellidos: true, email: true, managerId: true, tiendaId: true },
      },
    },
  });

  // Solo los turnos cuyo día (en Madrid) es hoy.
  const turnosHoy = candidatos.filter((t) => madridParts(t.fecha).fecha === hoy);
  if (turnosHoy.length === 0) return { revisados: 0, avisados: 0 };

  // Quién ya fichó ENTRADA hoy.
  const entradas = await prisma.fichaje.findMany({
    where: { tipo: "ENTRADA", timestamp: { gte: ventanaIni, lte: ventanaFin } },
    select: { userId: true, timestamp: true },
  });
  const entradasUserIds = new Set(
    entradas.filter((f) => madridParts(f.timestamp).fecha === hoy).map((f) => f.userId),
  );

  const olvidados = turnosOlvidados({
    turnos: turnosHoy.map((t) => ({ id: t.id, userId: t.userId, horaInicio: t.horaInicio, horaFin: t.horaFin })),
    entradasUserIds,
    nowMinutos: nowMin,
    graciaMin,
  });
  if (olvidados.length === 0) return { revisados: turnosHoy.length, avisados: 0 };

  const olvidadosIds = new Set(olvidados.map((o) => o.id));
  const turnosAvisar = turnosHoy.filter((t) => olvidadosIds.has(t.id));

  let avisados = 0;
  for (const t of turnosAvisar) {
    try {
      const empleado = `${t.user.nombre} ${t.user.apellidos}`.trim();
      const tienda = t.tienda?.nombre ?? "su centro";

      // Coordinador(es): managerId si existe; si no, OWNER/MANAGER de la sede.
      const coordinadores = await prisma.user.findMany({
        where: t.user.managerId
          ? { id: t.user.managerId, activo: true }
          : {
              activo: true,
              OR: [
                { rol: "OWNER" },
                ...(t.user.tiendaId ? [{ rol: "MANAGER" as const, tiendaId: t.user.tiendaId }] : []),
              ],
            },
        select: { id: true, nombre: true, email: true },
      });

      // ── Aviso al empleado ──
      if (t.user.email) {
        await prisma.notificacion.create({
          data: {
            userId: t.user.id,
            titulo: "No has fichado tu entrada",
            mensaje: `Tu turno de hoy empezó a las ${t.horaInicio} en ${tienda} y aún no has registrado la entrada.`,
            tipo: "olvido_fichaje",
            enlace: "/empleado",
          },
        });
        await sendSystemEmail(
          t.user.email,
          "Recordatorio: no has fichado tu entrada",
          `<p>Hola ${esc(t.user.nombre)},</p><p>Tu turno de hoy empezó a las <strong>${esc(t.horaInicio)}</strong> en ${esc(tienda)} y aún no has registrado la entrada. Ficha cuanto antes o solicita el registro a tu coordinador.</p>`,
        ).catch(() => {});
      }

      // ── Aviso a los coordinadores ──
      for (const c of coordinadores) {
        if (c.id === t.user.id) continue;
        await prisma.notificacion.create({
          data: {
            userId: c.id,
            titulo: "Empleado sin fichar",
            mensaje: `${empleado} no ha fichado la entrada de su turno de las ${t.horaInicio} (${tienda}).`,
            tipo: "olvido_fichaje",
            enlace: "/admin/solicitudes-fichaje",
          },
        });
        if (c.email) {
          await sendSystemEmail(
            c.email,
            `Aviso: ${empleado} no ha fichado`,
            `<p>Hola ${esc(c.nombre || "")},</p><p><strong>${esc(empleado)}</strong> no ha fichado la entrada de su turno de las <strong>${esc(t.horaInicio)}</strong> en ${esc(tienda)}.</p>`,
          ).catch(() => {});
        }
      }

      await prisma.turno.update({
        where: { id: t.id },
        data: { avisoFichajeEnviadoAt: ahora },
      });
      avisados++;
    } catch (err) {
      console.error(`[recordatorio-fichaje] turno=${t.id} error:`, err);
    }
  }

  return { revisados: turnosHoy.length, avisados };
}
