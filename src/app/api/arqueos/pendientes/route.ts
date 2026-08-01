/**
 * GET /api/arqueos/pendientes — los sobres que esperan a que alguien los recoja
 * (ticket 6d24af90).
 *
 * El responsable no pasa cada semana. Cuando aparece por una tienda puede haber
 * dos o tres sobres acumulados, y la pantalla de arqueos —que va por semana— no
 * los enseña juntos: para verlos habría que ir semana por semana adivinando
 * cuáles quedaron sin firmar.
 *
 * Esto devuelve **todos los pendientes, de todas las semanas**, dentro del
 * alcance de quien mira: administración los ve todos; el resto, los de sus sedes
 * (o los de la sede que haya confirmado hoy como centro de trabajo).
 *
 * Ordenados por sede y por semana, del más viejo al más nuevo: el sobre que
 * lleva tres semanas en el cajón es el que hay que sacar primero.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { filtroSede, whereSede } from "@/lib/cierre-turno/core";
import { sedesOperables } from "@/lib/cierre-turno/sedes-operables";
import { semanaLegible } from "@/lib/cierre-turno/arqueos";

export const GET = withTenant(
  withFeature("cierre_turno", async () => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaSesion = ((session.user as any).tiendaId as string | null) ?? null;

    const sedesPropias =
      rol === "OWNER" ? [] : await sedesOperables(prisma, { userId, tiendaId: tiendaSesion });
    const filtro = filtroSede(rol, sedesPropias, null);
    if (filtro.tipo === "ninguna") {
      return NextResponse.json({ pendientes: [], total: 0, autorizados: [], sinSede: true });
    }

    const [arqueos, autorizados] = await Promise.all([
      prisma.arqueo.findMany({
        where: { estado: "pendiente", ...whereSede(filtro) },
        select: {
          id: true,
          semana: true,
          hasta: true,
          efectivoDeclarado: true,
          declaradoEn: true,
          notas: true,
          tienda: { select: { id: true, nombre: true } },
          declaradoPor: { select: { nombre: true, apellidos: true } },
        },
        orderBy: [{ semana: "asc" }],
      }),
      // Quién puede firmar: se elige de aquí, y solo cuentan los que tienen PIN
      // puesto —sin PIN no hay firma posible—.
      prisma.user.findMany({
        where: { activo: true, puedeRecogerEfectivo: true, pinRecogidaHash: { not: null } },
        select: { id: true, nombre: true, apellidos: true },
        orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
      }),
    ]);

    const hoy = Date.now();
    const pendientes = arqueos
      .map((a) => ({
        id: a.id,
        semana: a.semana,
        semanaTexto: semanaLegible(a.semana),
        tiendaId: a.tienda.id,
        sede: a.tienda.nombre,
        importe: Number(a.efectivoDeclarado),
        declaradoEn: a.declaradoEn?.toISOString() ?? null,
        declaradoPor: a.declaradoPor
          ? `${a.declaradoPor.nombre} ${a.declaradoPor.apellidos}`.trim()
          : null,
        notas: a.notas,
        /** Días que lleva el sobre esperando, para poder avisar de los viejos. */
        diasEsperando: Math.max(
          0,
          Math.floor((hoy - new Date(a.hasta).getTime()) / 86_400_000),
        ),
      }))
      // Por sede y, dentro de cada una, del más viejo al más nuevo.
      .sort((a, b) => a.sede.localeCompare(b.sede) || a.semana.localeCompare(b.semana));

    return NextResponse.json({
      pendientes,
      total: Math.round(pendientes.reduce((n, p) => n + p.importe, 0) * 100) / 100,
      autorizados: autorizados.map((u) => ({
        id: u.id,
        nombre: `${u.nombre} ${u.apellidos}`.trim(),
      })),
    });
  }),
);
