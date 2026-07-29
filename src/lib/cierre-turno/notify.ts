/**
 * Avisos del módulo de cierre de turno.
 *
 * Destinatarios, igual que el aviso de fichaje fuera de sede: todos los OWNER
 * activos más los coordinadores de la sede implicada. Nunca al propio autor del
 * cierre — ya sabe lo que ha escrito.
 *
 * Best-effort: si el correo falla, el cierre queda registrado igual. Perder un
 * aviso es molesto; perder el cierre, inaceptable.
 */

import { prismaApp as prisma } from "@/lib/prisma";
import { sendSystemEmail } from "@/lib/email";
import { Rol } from "@/generated/prisma-tenant/client";

export interface CierreConIncidenciaCtx {
  empleado: { id: string; nombre: string; apellidos: string };
  sede: { id: string; nombre: string } | null;
  fecha: Date;
  incidencia: string;
  efectivo: number;
  tarjeta: number;
  ventas: { nombre: string; cantidad: number }[];
}

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Aviso al confirmar un cierre marcado con incidencia. */
export async function notifyCierreConIncidencia(ctx: CierreConIncidenciaCtx): Promise<void> {
  try {
    const cfg = await prisma.configuracionEmpresa.findUnique({
      where: { id: "singleton" },
      select: { nombre: true, appNombre: true, colorPrimario: true },
    });
    const empresa = cfg?.nombre ?? cfg?.appNombre ?? "empleaIA";
    const color = cfg?.colorPrimario ?? "#6366f1";

    const destinatarios = await prisma.user.findMany({
      where: {
        OR: [
          { rol: Rol.OWNER, activo: true },
          ...(ctx.sede ? [{ rol: Rol.MANAGER, activo: true, tiendaId: ctx.sede.id }] : []),
        ],
      },
      select: { id: true, email: true, nombre: true },
    });

    const empleado = `${ctx.empleado.nombre} ${ctx.empleado.apellidos}`.trim();
    const dia = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" }).format(ctx.fecha);
    const sede = ctx.sede?.nombre ?? "sin sede asignada";
    const subject = `Incidencia en el cierre de ${empleado} — ${sede}`;

    const filasVentas =
      ctx.ventas.length > 0
        ? ctx.ventas
            .map(
              (v) =>
                `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(v.nombre)}</td>` +
                `<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${v.cantidad}</td></tr>`,
            )
            .join("")
        : `<tr><td colspan="2" style="padding:8px;color:#666">Sin ventas registradas</td></tr>`;

    const html = `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;max-width:600px">
        <h2 style="color:${esc(color)};font-size:18px;margin:0 0 4px">Incidencia en un cierre de turno</h2>
        <p style="color:#555;margin:0 0 16px">${esc(empresa)}</p>
        <p><strong>${esc(empleado)}</strong> ha cerrado su turno del ${esc(dia)} en <strong>${esc(sede)}</strong>
        y ha registrado una incidencia:</p>
        <blockquote style="border-left:3px solid ${esc(color)};margin:12px 0;padding:8px 12px;background:#f8f8fb;color:#333">
          ${esc(ctx.incidencia)}
        </blockquote>
        <h3 style="font-size:14px;margin:20px 0 6px">Caja declarada</h3>
        <p style="margin:0">Efectivo: <strong>${eur(ctx.efectivo)}</strong> · Tarjeta: <strong>${eur(ctx.tarjeta)}</strong></p>
        <h3 style="font-size:14px;margin:20px 0 6px">Ventas del día</h3>
        <table style="border-collapse:collapse;width:100%;font-size:14px">${filasVentas}</table>
        <p style="color:#666;font-size:12px;margin-top:24px">
          Recibes este aviso porque administras ${esc(empresa)} o coordinas esa sede.
        </p>
      </div>`;

    await Promise.allSettled(
      destinatarios
        .filter((d) => d.id !== ctx.empleado.id && d.email)
        .map((d) => sendSystemEmail(d.email, subject, html)),
    );
  } catch (err) {
    console.error("[cierre-turno] notifyCierreConIncidencia falló:", err);
  }
}
