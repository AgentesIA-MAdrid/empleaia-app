/**
 * POST  /api/cierre-turno/caja — el comercial guarda y confirma su cierre de
 *   caja del día (efectivo y tarjeta). Cada comercial cierra SU caja: eso es lo
 *   que permite atribuir un descuadre a una persona concreta.
 *
 * PATCH /api/cierre-turno/caja — un administrador corrige una caja ya
 *   confirmada. Exige motivo y deja rastro en `CierreCajaEdicion`: sin eso,
 *   "solo lo pueden modificar los administradores" no significa nada el día que
 *   se discuta una diferencia.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import {
  diaMadrid,
  normalizarImporte,
  normalizarMotivoEdicion,
  puedeEditarCaja,
} from "@/lib/cierre-turno/core";

export const POST = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaFicha = (session.user as any).tiendaId as string | null;

    const body = (await req.json().catch(() => null)) as {
      efectivo?: unknown;
      tarjeta?: unknown;
      /** true = cerrar la caja (a partir de ahí ya no la toca). */
      confirmar?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

    const ef = normalizarImporte(body.efectivo ?? 0);
    if (!ef.ok) return NextResponse.json({ error: `Efectivo: ${ef.error}` }, { status: 400 });
    const ta = normalizarImporte(body.tarjeta ?? 0);
    if (!ta.ok) return NextResponse.json({ error: `Tarjeta: ${ta.error}` }, { status: 400 });

    const fecha = new Date(`${diaMadrid()}T00:00:00Z`);
    const cierre = await prisma.cierreTurno.findUnique({
      where: { userId_fecha: { userId, fecha } },
      select: {
        id: true,
        tiendaId: true,
        completadoEn: true,
        caja: { select: { id: true, confirmadoEn: true } },
      },
    });
    if (!cierre) {
      return NextResponse.json(
        { error: "Empieza por registrar las ventas del día.", code: "sin_borrador" },
        { status: 409 },
      );
    }
    if (cierre.caja?.confirmadoEn) {
      return NextResponse.json(
        {
          error: "Tu cierre de caja de hoy ya está confirmado y no se puede modificar. Habla con un administrador.",
          code: "caja_confirmada",
        },
        { status: 409 },
      );
    }

    const confirmar = body.confirmar === true;
    const caja = await prisma.cierreCaja.upsert({
      where: { cierreId: cierre.id },
      create: {
        cierreId: cierre.id,
        // La sede que confirmó al empezar (ticket 8c05f3e1): el dinero tiene que
        // caer en el arqueo de la tienda donde de verdad ha estado, no en la de
        // su ficha.
        tiendaId: cierre.tiendaId ?? tiendaFicha,
        fecha,
        efectivo: ef.importe,
        tarjeta: ta.importe,
        ...(confirmar ? { confirmadoEn: new Date() } : {}),
      },
      update: {
        efectivo: ef.importe,
        tarjeta: ta.importe,
        ...(confirmar ? { confirmadoEn: new Date() } : {}),
      },
      select: { id: true, efectivo: true, tarjeta: true, confirmadoEn: true },
    });

    return NextResponse.json({
      id: caja.id,
      efectivo: Number(caja.efectivo),
      tarjeta: Number(caja.tarjeta),
      confirmado: Boolean(caja.confirmadoEn),
    });
  }),
);

export const PATCH = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const adminId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;

    const body = (await req.json().catch(() => null)) as {
      cajaId?: unknown;
      efectivo?: unknown;
      tarjeta?: unknown;
      motivo?: unknown;
    } | null;
    if (!body || typeof body.cajaId !== "string") {
      return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
    }

    const caja = await prisma.cierreCaja.findUnique({
      where: { id: body.cajaId },
      select: {
        id: true,
        efectivo: true,
        tarjeta: true,
        confirmadoEn: true,
        cierre: { select: { userId: true } },
      },
    });
    if (!caja) return NextResponse.json({ error: "Cierre de caja no encontrado" }, { status: 404 });

    const esPropio = caja.cierre.userId === adminId;
    if (!puedeEditarCaja(rol, Boolean(caja.confirmadoEn), esPropio)) {
      return NextResponse.json(
        { error: "Solo un administrador puede corregir un cierre de caja confirmado." },
        { status: 403 },
      );
    }

    const motivo = normalizarMotivoEdicion(body.motivo);
    if (!motivo.ok) return NextResponse.json({ error: motivo.error }, { status: 400 });

    const cambios: { campo: string; antes: number; despues: number }[] = [];
    const data: { efectivo?: number; tarjeta?: number } = {};

    if (body.efectivo !== undefined) {
      const v = normalizarImporte(body.efectivo);
      if (!v.ok) return NextResponse.json({ error: `Efectivo: ${v.error}` }, { status: 400 });
      const antes = Number(caja.efectivo);
      if (v.importe !== antes) {
        data.efectivo = v.importe;
        cambios.push({ campo: "efectivo", antes, despues: v.importe });
      }
    }
    if (body.tarjeta !== undefined) {
      const v = normalizarImporte(body.tarjeta);
      if (!v.ok) return NextResponse.json({ error: `Tarjeta: ${v.error}` }, { status: 400 });
      const antes = Number(caja.tarjeta);
      if (v.importe !== antes) {
        data.tarjeta = v.importe;
        cambios.push({ campo: "tarjeta", antes, despues: v.importe });
      }
    }

    if (cambios.length === 0) {
      return NextResponse.json({ error: "No has cambiado ningún importe." }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.cierreCaja.update({ where: { id: caja.id }, data });
      await tx.cierreCajaEdicion.createMany({
        data: cambios.map((c) => ({
          cajaId: caja.id,
          adminId,
          campo: c.campo,
          valorAntes: c.antes,
          valorDespues: c.despues,
          motivo: motivo.motivo,
        })),
      });
    });

    return NextResponse.json({ ok: true, corregidos: cambios.map((c) => c.campo) });
  }),
);
