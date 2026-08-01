/**
 * PUT /api/cierre-turno/sede — confirma en qué tienda se ha trabajado hoy
 * (ticket 8c05f3e1).
 *
 * Antes de empezar el cierre se le pregunta al comercial, con la respuesta ya
 * elegida (ver `sugerirSedeDelDia`). Lo que conteste manda sobre su ficha y
 * sobre el cuadrante: quien está cerrando es quien sabe dónde ha pasado el día,
 * y un correturnos sin sede asignada tenía la caja y los objetivos de tienda en
 * blanco estando de hecho en una.
 *
 * La sede se guarda en el cierre de hoy (`CierreTurno.tiendaId`) y con ella se
 * calculan a partir de ahí los objetivos de la tienda, el cierre de caja y el
 * arqueo. Se crea el cierre si aún no existía: es lo primero que hace al entrar.
 *
 * Solo se admite una sede ACTIVA. No se comprueba que sea "suya" a propósito:
 * el caso que resuelve esto es justamente el de quien cubre donde no le tocaba.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid } from "@/lib/cierre-turno/core";

export const PUT = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = session.user.id!;

    const body = (await req.json().catch(() => null)) as { tiendaId?: unknown } | null;
    const tiendaId = typeof body?.tiendaId === "string" ? body.tiendaId : "";
    if (!tiendaId) {
      return NextResponse.json({ error: "Elige tu centro de trabajo." }, { status: 400 });
    }

    const sede = await prisma.tienda.findFirst({
      where: { id: tiendaId, activa: true },
      select: { id: true, nombre: true, sinEfectivo: true },
    });
    if (!sede) {
      return NextResponse.json({ error: "Esa tienda no existe o está cerrada." }, { status: 404 });
    }

    const dia = diaMadrid();
    const fecha = new Date(`${dia}T00:00:00Z`);

    const cierre = await prisma.cierreTurno.upsert({
      where: { userId_fecha: { userId, fecha } },
      create: { userId, fecha, tiendaId: sede.id },
      update: { tiendaId: sede.id },
      select: { id: true, tiendaId: true },
    });

    return NextResponse.json({
      ok: true,
      cierreId: cierre.id,
      sede: { id: sede.id, nombre: sede.nombre, sinEfectivo: sede.sinEfectivo },
    });
  }),
);
