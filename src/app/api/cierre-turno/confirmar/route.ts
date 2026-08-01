/**
 * POST /api/cierre-turno/confirmar — paso 4: el comercial declara si ha habido
 * incidencia y cierra su turno.
 *
 * Exige tener la caja confirmada: sin caja, el cierre no está hecho. Lo que NO
 * exige es haber vendido algo — un día sin ventas es un dato válido.
 *
 * Y, si es el último turno del domingo en su sede, exige el **arqueo semanal**
 * declarado (ticket 3b7e05d1): quien cierra la tienda ese día es quien cuenta el
 * efectivo acumulado y lo mete en el sobre. Se comprueba aquí y no solo en la
 * pantalla, que es donde de verdad se decide.
 *
 * Si marca incidencia, sale el aviso a administración y al coordinador de la
 * sede. El correo es best-effort: el cierre queda registrado aunque falle.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid, normalizarIncidencia } from "@/lib/cierre-turno/core";
import { notifyCierreConIncidencia } from "@/lib/cierre-turno/notify";
import { tocaArqueo } from "@/lib/cierre-turno/arqueo-obligatorio";
import { semanaISO } from "@/lib/cierre-turno/arqueos";

export const POST = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;

    const body = (await req.json().catch(() => null)) as {
      hayIncidencia?: unknown;
      incidencia?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

    const inc = normalizarIncidencia(body.hayIncidencia, body.incidencia);
    if (!inc.ok) return NextResponse.json({ error: inc.error }, { status: 400 });

    const fecha = new Date(`${diaMadrid()}T00:00:00Z`);
    const cierre = await prisma.cierreTurno.findUnique({
      where: { userId_fecha: { userId, fecha } },
      select: {
        id: true,
        completadoEn: true,
        tiendaId: true,
        user: { select: { id: true, nombre: true, apellidos: true } },
        tienda: { select: { id: true, nombre: true, sinEfectivo: true, esOficina: true } },
        caja: { select: { efectivo: true, tarjeta: true, confirmadoEn: true } },
        ventas: { select: { nombreArticulo: true, cantidad: true } },
      },
    });

    if (!cierre) {
      return NextResponse.json(
        { error: "Empieza por registrar las ventas del día.", code: "sin_borrador" },
        { status: 409 },
      );
    }
    if (cierre.completadoEn) {
      return NextResponse.json(
        { error: "Ya has cerrado tu turno de hoy.", code: "ya_cerrado" },
        { status: 409 },
      );
    }
    if (!cierre.caja?.confirmadoEn) {
      return NextResponse.json(
        { error: "Antes de cerrar el turno tienes que confirmar el cierre de caja.", code: "sin_caja" },
        { status: 409 },
      );
    }

    // El arqueo del domingo: si le toca a esta persona y no está declarado, el
    // turno no se cierra. Es el único paso del cierre que es de la TIENDA y no
    // suyo, y por eso se comprueba contra el arqueo de la sede, no contra algo
    // que él lleve encima.
    if (cierre.tiendaId && cierre.tienda) {
      const semana = semanaISO(fecha);
      const [turnosDeLaSede, arqueoSemana] = await Promise.all([
        prisma.turno.findMany({
          where: { tiendaId: cierre.tiendaId, fecha, estado: "PUBLICADO" },
          select: { userId: true, horaFin: true },
        }),
        prisma.arqueo.findUnique({
          where: { tiendaId_semana: { tiendaId: cierre.tiendaId, semana } },
          select: { id: true },
        }),
      ]);
      if (
        tocaArqueo({
          fecha,
          userId,
          turnosDeLaSede,
          arqueoYaDeclarado: Boolean(arqueoSemana),
          sedeSinCaja: cierre.tienda.sinEfectivo || cierre.tienda.esOficina,
        })
      ) {
        return NextResponse.json(
          {
            error:
              "Hoy cierras tú la tienda: cuenta el efectivo acumulado, mételo en el sobre y declara el arqueo de la semana antes de cerrar el turno.",
            code: "sin_arqueo",
          },
          { status: 409 },
        );
      }
    }

    await prisma.cierreTurno.update({
      where: { id: cierre.id },
      data: { estado: "completado", completadoEn: new Date(), incidencia: inc.incidencia },
    });

    if (inc.incidencia) {
      void notifyCierreConIncidencia({
        empleado: cierre.user,
        sede: cierre.tienda,
        fecha,
        incidencia: inc.incidencia,
        efectivo: Number(cierre.caja.efectivo),
        tarjeta: Number(cierre.caja.tarjeta),
        ventas: cierre.ventas.map((v) => ({ nombre: v.nombreArticulo, cantidad: v.cantidad })),
      });
    }

    return NextResponse.json({ ok: true, conIncidencia: Boolean(inc.incidencia) });
  }),
);
