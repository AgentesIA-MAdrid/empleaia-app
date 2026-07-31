/**
 * GET /api/cierre-turno/acceso — ¿le toca a esta persona ver el módulo, y cómo
 * lleva el cierre de hoy?
 *
 * Lo usa la pantalla de fichaje (`/empleado`) para decidir si pinta el botón
 * "Cierre de turno" debajo del cuadro de fichaje. La regla de quién lo ve es la
 * MISMA del menú (`moduloCierreVisibleEnMenu`): si no, durante el rodaje el
 * módulo quedaría escondido en el menú y ofrecido a un botón de distancia en la
 * pantalla que más se usa.
 *
 * Devuelve además el estado del cierre de hoy (empezado / cerrado) para que el
 * botón diga si hay que empezar, continuar o si ya está todo hecho.
 *
 * No condiciona el fichaje en ningún caso (RD 8/2019): si esto falla, la
 * pantalla de fichar sigue funcionando y sencillamente no aparece el botón.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid } from "@/lib/cierre-turno/core";
import { moduloCierreVisibleEnMenu } from "@/lib/cierre-turno/visibilidad";

export const GET = withTenant(
  withFeature("cierre_turno", async () => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = ((session.user as any).rol as string) ?? "EMPLEADO";
    const userId = session.user.id!;
    const fecha = new Date(`${diaMadrid()}T00:00:00Z`);

    const [cfg, persona, cierre] = await Promise.all([
      prisma.configuracionEmpresa.findUnique({
        where: { id: "singleton" },
        select: { cierreTurnoEnRodaje: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { cierreTurnoPiloto: true },
      }),
      prisma.cierreTurno.findUnique({
        where: { userId_fecha: { userId, fecha } },
        select: { completadoEn: true },
      }),
    ]);

    return NextResponse.json({
      visible: moduloCierreVisibleEnMenu({
        rol,
        // El plan ya lo ha filtrado `withFeature`: aquí nunca está bloqueada.
        bloqueada: false,
        // Sin fila de configuración se asume rodaje, igual que en el layout.
        enRodaje: cfg?.cierreTurnoEnRodaje ?? true,
        accesoAnticipado: persona?.cierreTurnoPiloto === true,
      }),
      empezado: cierre !== null,
      cerrado: Boolean(cierre?.completadoEn),
    });
  }),
);
