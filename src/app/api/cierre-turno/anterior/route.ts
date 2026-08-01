/**
 * GET /api/cierre-turno/anterior — el último cierre de su sede (ticket 2e6b91f4).
 *
 * Por qué existe: al fichar la entrada se le pide al comercial que revise el
 * fondo de caja y el stock que le deja el turno anterior… y no tenía forma de
 * verlos. Los puntos de control preguntaban por algo invisible.
 *
 * Devuelve, del último cierre de la sede en la que va a trabajar (excluyendo el
 * suyo de hoy, que es el que está a punto de abrir):
 *
 *  - Quién lo cerró y qué día.
 *  - El efectivo y la tarjeta que declaró, y si la caja quedó confirmada.
 *  - La incidencia que dejara escrita, que es justo lo que hay que saber antes
 *    de empezar.
 *  - Los adjuntos: el Excel del stock y el comprobante del TPV, por id y nombre.
 *    El contenido NO va aquí —son data URL de cientos de KB— sino que se
 *    descarga de `/api/cierre-turno/adjuntos/[id]`.
 *
 * Es de lectura y de su propia tienda: se acota a las sedes del usuario
 * (`sedesDelUsuario`), nunca a un id que venga del cliente. Un comercial ve la
 * caja de su sede, que es la que va a contar con sus propias manos.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid } from "@/lib/cierre-turno/core";
import { sedesDelUsuario } from "@/lib/tiendas/sedes-usuario";

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaId = ((session.user as any).tiendaId as string | null) ?? null;

    // Su sede, o la que pida SI es suya: quien cubre en varias necesita ver la
    // caja de la tienda en la que entra hoy, no la de su sede principal.
    const propias = await sedesDelUsuario(prisma, { userId, tiendaId });
    const pedida = new URL(req.url).searchParams.get("tiendaId");
    const sedes = pedida && propias.includes(pedida) ? [pedida] : propias;
    if (sedes.length === 0) {
      return NextResponse.json({ cierre: null, motivo: "sin_sede" });
    }

    const hoy = new Date(`${diaMadrid()}T00:00:00Z`);
    const cierre = await prisma.cierreTurno.findFirst({
      where: {
        tiendaId: { in: sedes },
        // El de hoy no: si alguien ya cerró hoy en esa tienda, lo que le
        // interesa es lo que le dejaron, no lo que está pasando ahora mismo.
        fecha: { lt: hoy },
        // Y no el suyo: "el turno anterior" es el de otra persona (o el de otro
        // día), y verse a sí mismo no le dice nada nuevo.
        userId: { not: userId },
      },
      orderBy: [{ fecha: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        fecha: true,
        incidencia: true,
        completadoEn: true,
        user: { select: { nombre: true, apellidos: true } },
        tienda: { select: { id: true, nombre: true } },
        caja: {
          select: {
            efectivo: true,
            tarjeta: true,
            confirmadoEn: true,
            adjuntos: { select: { id: true, tipo: true, nombre: true, mime: true } },
          },
        },
      },
    });

    if (!cierre) return NextResponse.json({ cierre: null, motivo: "sin_cierres" });

    return NextResponse.json({
      cierre: {
        id: cierre.id,
        fecha: cierre.fecha.toISOString().slice(0, 10),
        quien: `${cierre.user.nombre} ${cierre.user.apellidos}`.trim(),
        sede: cierre.tienda?.nombre ?? null,
        incidencia: cierre.incidencia,
        completado: cierre.completadoEn !== null,
        caja: cierre.caja
          ? {
              efectivo: Number(cierre.caja.efectivo),
              tarjeta: Number(cierre.caja.tarjeta),
              confirmada: cierre.caja.confirmadoEn !== null,
              // El Excel del stock y el comprobante del TPV, para abrirlos.
              adjuntos: cierre.caja.adjuntos,
            }
          : null,
      },
    });
  }),
);
