/**
 * GET  /api/cierre-turno — cierres visibles según el rol.
 *   ?fecha=YYYY-MM-DD   día concreto (por defecto, hoy)
 *   ?tiendaId=…         filtro de sede (OWNER; el MANAGER va atado a la suya)
 *
 * El alcance no lo elige el cliente: sale del rol (ver `alcanceSegunRol`).
 * Un comercial solo ve sus cierres aunque pida otra sede.
 *
 * POST /api/cierre-turno — guarda el borrador del día del propio comercial
 * (paso 1: cantidades vendidas y detalle de la jornada). Idempotente: se puede
 * llamar tantas veces como haga falta mientras el cierre no esté completado.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import {
  alcanceSegunRol,
  diaMadrid,
  normalizarVentas,
} from "@/lib/cierre-turno/core";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaPropia = (session.user as any).tiendaId as string | null;

    const url = new URL(req.url);
    const fechaParam = url.searchParams.get("fecha");
    if (fechaParam && !FECHA_RE.test(fechaParam)) {
      return NextResponse.json({ error: "Fecha no válida" }, { status: 400 });
    }
    const fecha = new Date(`${fechaParam ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);

    const alcance = alcanceSegunRol(rol);
    const tiendaFiltro = url.searchParams.get("tiendaId");

    const where =
      alcance === "propio"
        ? { userId, fecha }
        : alcance === "sede"
          ? { fecha, tiendaId: tiendaPropia }
          : { fecha, ...(tiendaFiltro ? { tiendaId: tiendaFiltro } : {}) };

    const cierres = await prisma.cierreTurno.findMany({
      where,
      select: {
        id: true,
        fecha: true,
        estado: true,
        incidencia: true,
        completadoEn: true,
        user: { select: { id: true, nombre: true, apellidos: true } },
        tienda: { select: { id: true, nombre: true } },
        caja: { select: { efectivo: true, tarjeta: true, confirmadoEn: true } },
        _count: { select: { ventas: true } },
      },
      orderBy: [{ tiendaId: "asc" }, { userId: "asc" }],
    });

    return NextResponse.json({
      alcance,
      fecha: fecha.toISOString().slice(0, 10),
      cierres: cierres.map((c) => ({
        id: c.id,
        estado: c.estado,
        tieneIncidencia: Boolean(c.incidencia),
        completado: Boolean(c.completadoEn),
        empleado: `${c.user.nombre} ${c.user.apellidos}`.trim(),
        empleadoId: c.user.id,
        sede: c.tienda?.nombre ?? null,
        articulosVendidos: c._count.ventas,
        caja: c.caja
          ? {
              efectivo: Number(c.caja.efectivo),
              tarjeta: Number(c.caja.tarjeta),
              confirmado: Boolean(c.caja.confirmadoEn),
            }
          : null,
      })),
    });
  }),
);

export const POST = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaId = (session.user as any).tiendaId as string | null;

    const body = (await req.json().catch(() => null)) as {
      ventas?: { articuloId?: unknown; cantidad?: unknown }[];
      detalleJornada?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

    const fecha = new Date(`${diaMadrid()}T00:00:00Z`);

    // Un cierre ya completado no se reabre: si hay que corregirlo, lo hace un
    // administrador (y queda registrado). Aquí solo se guarda el borrador.
    const existente = await prisma.cierreTurno.findUnique({
      where: { userId_fecha: { userId, fecha } },
      select: { id: true, completadoEn: true },
    });
    if (existente?.completadoEn) {
      return NextResponse.json(
        { error: "El cierre de hoy ya está cerrado. Pide a un administrador que lo corrija.", code: "cierre_cerrado" },
        { status: 409 },
      );
    }

    const catalogo = await prisma.articuloVenta.findMany({
      where: { activo: true },
      select: { id: true, nombre: true },
    });
    const { ventas, descartadas } = normalizarVentas(catalogo, body.ventas);
    const nombrePorId = new Map(catalogo.map((a) => [a.id, a.nombre]));
    const detalle =
      typeof body.detalleJornada === "string" ? body.detalleJornada.trim().slice(0, 4000) : null;

    const cierre = await prisma.$transaction(async (tx) => {
      const c = await tx.cierreTurno.upsert({
        where: { userId_fecha: { userId, fecha } },
        create: { userId, tiendaId, fecha, detalleJornada: detalle },
        update: { detalleJornada: detalle },
        select: { id: true },
      });
      // Se reemplazan las ventas del día en bloque: es lo que el comercial ve
      // en pantalla, y así una cantidad borrada desaparece de verdad.
      await tx.cierreTurnoVenta.deleteMany({ where: { cierreId: c.id } });
      if (ventas.length > 0) {
        await tx.cierreTurnoVenta.createMany({
          data: ventas.map((v) => ({
            cierreId: c.id,
            articuloId: v.articuloId,
            nombreArticulo: nombrePorId.get(v.articuloId) ?? "",
            cantidad: v.cantidad,
          })),
        });
      }
      return c;
    });

    return NextResponse.json(
      {
        id: cierre.id,
        guardadas: ventas.length,
        descartadas,
        unidades: ventas.reduce((n, v) => n + v.cantidad, 0),
      },
      { status: 200 },
    );
  }),
);
