/**
 * GET /api/conciliacion?desde=&hasta=&tiendaId= — los dos cuadres del módulo.
 *
 *  1. **Efectivo**: lo que suman los cierres de caja frente a lo que las tiendas
 *     declararon en sus arqueos de esas semanas.
 *  2. **Tarjeta**: lo cobrado con datáfono frente a los ingresos del banco
 *     importados del extracto.
 *
 * Por debajo del umbral del cliente (`descuadreUmbral`, 1 € por defecto) no se
 * marca descuadre: son redondeos y llenar la pantalla de avisos de céntimos la
 * vuelve inútil.
 *
 * Solo administración: cruza el extracto de la cuenta de la empresa.
 *
 * Aviso honesto que la pantalla enseña: el cuadre de tarjeta compara el periodo
 * completo, no movimiento a movimiento. Las liquidaciones del datáfono entran en
 * el banco con uno o dos días de retraso, así que en un rango corto la
 * diferencia puede ser solo desfase. Se informa en vez de dar por bueno un
 * descuadre que no lo es.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid, diferenciaArqueo, esDescuadre } from "@/lib/cierre-turno/core";
import { semanaISO } from "@/lib/cierre-turno/arqueos";
import { rangoExclusivo, totalesCajaPorSede, umbralDescuadre } from "@/lib/cierre-turno/caja-queries";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;
/** Tope del rango: un año. */
const MAX_DIAS = 366;

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    if (rol !== "OWNER") {
      return NextResponse.json(
        { error: "La conciliación es de administración." },
        { status: 403 },
      );
    }

    const url = new URL(req.url);
    const hoy = diaMadrid();
    const desdeStr = url.searchParams.get("desde") ?? `${hoy.slice(0, 8)}01`;
    const hastaStr = url.searchParams.get("hasta") ?? hoy;
    if (!FECHA_RE.test(desdeStr) || !FECHA_RE.test(hastaStr)) {
      return NextResponse.json({ error: "Las fechas tienen que venir como AAAA-MM-DD." }, { status: 400 });
    }
    const desde = new Date(`${desdeStr}T00:00:00Z`);
    const hasta = new Date(`${hastaStr}T00:00:00Z`);
    if (!(desde <= hasta)) {
      return NextResponse.json({ error: "La fecha de inicio es posterior a la de fin." }, { status: 400 });
    }
    if ((hasta.getTime() - desde.getTime()) / DIA_MS > MAX_DIAS) {
      return NextResponse.json({ error: "El periodo no puede pasar de un año." }, { status: 400 });
    }
    const tiendaId = url.searchParams.get("tiendaId") || null;

    // Semanas ISO que toca el periodo: son la unidad del arqueo, y el rango
    // pedido casi nunca cae justo en lunes y domingo.
    const semanas: string[] = [];
    for (let t = desde.getTime(); t <= hasta.getTime(); t += DIA_MS) {
      const s = semanaISO(new Date(t));
      if (!semanas.includes(s)) semanas.push(s);
    }

    const [sedes, cajaPorSede, arqueos, banco, umbral] = await Promise.all([
      prisma.tienda.findMany({
        where: {
          activa: true,
          // Fuera las sedes sin efectivo nuestro y la oficina (ticket 9d4e17c2):
          // en un córner el dinero lo liquida el tercero y en la oficina no hay
          // caja. Enseñarlas aquí sería pedir un arqueo que nadie puede hacer.
          esOficina: false,
          sinEfectivo: false,
          ...(tiendaId ? { id: tiendaId } : {}),
        },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" },
      }),
      totalesCajaPorSede(prisma, { desde, hasta, tiendaId }),
      prisma.arqueo.groupBy({
        by: ["tiendaId"],
        where: { semana: { in: semanas }, ...(tiendaId ? { tiendaId } : {}) },
        _sum: { efectivoDeclarado: true, efectivoRecogido: true },
        _count: true,
      }),
      prisma.movimientoBanco.groupBy({
        by: ["tiendaId"],
        where: { fecha: rangoExclusivo(desde, hasta), ...(tiendaId ? { tiendaId } : {}) },
        _sum: { importe: true },
        _count: true,
      }),
      umbralDescuadre(prisma),
    ]);

    const arqueoPorSede = new Map(
      arqueos.map((a) => [
        a.tiendaId,
        {
          declarado: Number(a._sum.efectivoDeclarado ?? 0),
          recogido: Number(a._sum.efectivoRecogido ?? 0),
          n: a._count,
        },
      ]),
    );
    const bancoPorSede = new Map(
      banco.map((b) => [b.tiendaId ?? "", { importe: Number(b._sum.importe ?? 0), n: b._count }]),
    );

    // Movimientos del banco sin sede asignada: no se pueden atribuir a una
    // tienda, así que se muestran aparte en vez de repartirlos a ojo.
    const bancoSinSede = bancoPorSede.get("") ?? { importe: 0, n: 0 };
    // Lo mismo con las cajas de gente sin sede: si no se dijeran, el total de
    // la pantalla no sumaría lo que hay en la BD y parecería que falta dinero.
    const cajaSinSede = cajaPorSede.get("") ?? { efectivo: 0, tarjeta: 0, cajas: 0 };

    const filas = sedes.map((s) => {
      const caja = cajaPorSede.get(s.id) ?? { efectivo: 0, tarjeta: 0, cajas: 0 };
      const arq = arqueoPorSede.get(s.id) ?? { declarado: 0, recogido: 0, n: 0 };
      const ban = bancoPorSede.get(s.id) ?? { importe: 0, n: 0 };

      const difEfectivo = diferenciaArqueo(arq.declarado, caja.efectivo);
      const difTarjeta = diferenciaArqueo(ban.importe, caja.tarjeta);

      return {
        tiendaId: s.id,
        sede: s.nombre,
        cajas: caja.cajas,
        efectivo: {
          segunCierres: caja.efectivo,
          segunArqueos: arq.declarado,
          recogido: arq.recogido,
          arqueos: arq.n,
          diferencia: difEfectivo,
          // Sin ningún arqueo declarado no hay nada que cuadrar: decir
          // "descuadre de 1.200 €" cuando lo que falta es el arqueo es un
          // falso positivo garantizado.
          descuadre: arq.n > 0 && esDescuadre(difEfectivo, umbral),
          sinArqueos: arq.n === 0 && caja.efectivo > 0,
        },
        tarjeta: {
          segunCierres: caja.tarjeta,
          segunBanco: ban.importe,
          movimientos: ban.n,
          diferencia: difTarjeta,
          descuadre: ban.n > 0 && esDescuadre(difTarjeta, umbral),
          sinBanco: ban.n === 0 && caja.tarjeta > 0,
        },
      };
    });

    const suma = (f: (x: (typeof filas)[number]) => number) => filas.reduce((n, x) => n + f(x), 0);

    return NextResponse.json({
      desde: desdeStr,
      hasta: hastaStr,
      semanas,
      umbral,
      filas,
      bancoSinSede,
      cajaSinSede,
      totales: {
        efectivoCierres: Math.round(suma((f) => f.efectivo.segunCierres) * 100) / 100,
        efectivoArqueos: Math.round(suma((f) => f.efectivo.segunArqueos) * 100) / 100,
        tarjetaCierres: Math.round(suma((f) => f.tarjeta.segunCierres) * 100) / 100,
        tarjetaBanco: Math.round(suma((f) => f.tarjeta.segunBanco) * 100) / 100,
        descuadres: filas.filter((f) => f.efectivo.descuadre || f.tarjeta.descuadre).length,
      },
    });
  }),
);
