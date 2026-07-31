/**
 * GET /api/cierre-turno/progreso — paso 2 del asistente ("Cómo vas").
 *
 * Devuelve, del mes en curso: lo que lleva vendido el propio comercial y su
 * sede, frente a los objetivos que administración haya fijado. Es de lectura y
 * de uno mismo: no hace falta rol especial, cada quien ve lo suyo y el total de
 * su sede (que ya ve en el cuadrante y en los cierres de su tienda).
 *
 * Sin objetivo fijado no se devuelve un cero: se dice que no hay objetivo. Un
 * "0 % conseguido" cuando nadie ha puesto objetivo desanima por un dato que no
 * existe.
 *
 * Los productos que administración ha dejado fuera de los objetivos no suman en
 * el progreso, y si le han puesto objetivos por grupo de productos vienen en
 * `porGrupo` (ticket 714c76dd).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid } from "@/lib/cierre-turno/core";
import {
  anotarVentas,
  categoriasDelCatalogo,
  cuentaParaObjetivos,
  normalizarMes,
  progresoDe,
  vendidoDeSujeto,
} from "@/lib/cierre-turno/objetivos";
import {
  preciosActivos as leerPreciosActivos,
  ventasAgregadas,
} from "@/lib/cierre-turno/ventas-queries";

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaId = ((session.user as any).tiendaId as string | null) ?? null;

    const mesPedido = new URL(req.url).searchParams.get("mes") ?? diaMadrid().slice(0, 7);
    const mesOk = normalizarMes(mesPedido);
    if (!mesOk.ok) return NextResponse.json({ error: mesOk.error }, { status: 400 });
    const mes = mesOk.mes;

    const [objetivos, ventasBrutas, articulos, preciosOn] = await Promise.all([
      prisma.objetivoVenta.findMany({
        where: {
          mes,
          // Solo lo que le afecta: sus objetivos y los de su sede.
          OR: [{ userId }, ...(tiendaId ? [{ tiendaId }] : [])],
        },
        select: {
          id: true,
          mes: true,
          userId: true,
          tiendaId: true,
          articuloId: true,
          categoria: true,
          cantidad: true,
        },
      }),
      // Las ventas de toda la sede: hacen falta para el total de la tienda, y
      // las propias son un subconjunto. Sin sede asignada se piden solo las
      // suyas: con `tiendaId: null` el filtro desaparecería y traeríamos las
      // ventas de toda la empresa para nada.
      ventasAgregadas(prisma, tiendaId ? { mes, tiendaId } : { mes, userId }),
      prisma.articuloVenta.findMany({
        where: { activo: true },
        select: { id: true, nombre: true, categoria: true, precio: true, cuentaParaObjetivos: true },
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      }),
      leerPreciosActivos(prisma),
    ]);

    // Las ventas se anotan con el catálogo completo: así los productos que
    // administración ha dejado fuera de los objetivos no empujan el progreso, y
    // cada venta sabe a qué grupo pertenece.
    const ventas = anotarVentas(ventasBrutas, articulos);

    // Sin sede asignada no hay ventas de sede que enseñar: `ventasAgregadas`
    // devolvería las de todo el mundo y eso no es "tu tienda".
    const ventasPropias = ventas.filter((v) => v.userId === userId);
    const ventasSede = tiendaId ? ventas : ventasPropias;

    // Los ids del catálogo que cuenta acotan qué objetivos por producto suman en
    // el total cuando administración no ha fijado uno de unidades totales.
    const paraObjetivos = articulos.filter((a) => cuentaParaObjetivos(a));
    const articuloIds = paraObjetivos.map((a) => a.id);
    const categorias = categoriasDelCatalogo(paraObjetivos);

    const propio = progresoDe(
      objetivos,
      ventasPropias,
      { ambito: "comercial", id: userId },
      articuloIds,
      paraObjetivos,
    );
    const sede = tiendaId
      ? progresoDe(objetivos, ventasSede, { ambito: "sede", id: tiendaId }, articuloIds, paraObjetivos)
      : null;

    // Desglose por artículo del propio comercial: es donde ve qué le falta.
    const porArticulo = articulos
      .map((a) => {
        const vendido = vendidoDeSujeto(ventasPropias, { ambito: "comercial", id: userId }, a.id);
        const objetivo =
          objetivos.find((o) => o.userId === userId && o.articuloId === a.id)?.cantidad ?? null;
        return {
          articuloId: a.id,
          nombre: a.nombre,
          vendido,
          objetivo,
          consecucion:
            objetivo && objetivo > 0 ? Math.round((vendido / objetivo) * 1000) / 10 : null,
          importe:
            preciosOn && a.precio !== null
              ? Math.round(vendido * Number(a.precio) * 100) / 100
              : null,
          // Lo vendido de un producto excluido no suma en el objetivo de arriba;
          // se dice en la fila para que las dos cifras no parezcan reñidas.
          cuentaParaObjetivos: cuentaParaObjetivos(a),
        };
      })
      // Solo lo que aporta información: con objetivo o con ventas. Una lista de
      // 80 artículos a cero no dice nada a nadie.
      .filter((f) => f.vendido > 0 || f.objetivo !== null);

    // Desglose por grupo: si administración le ha puesto objetivos de grupo, es
    // ahí donde los ve (en la tabla de artículos no aparecen).
    const porGrupo = categorias
      .map((c) => {
        const vendido = vendidoDeSujeto(ventasPropias, { ambito: "comercial", id: userId }, null, c);
        const objetivo =
          objetivos.find((o) => o.userId === userId && o.categoria === c)?.cantidad ?? null;
        return {
          grupo: c,
          vendido,
          objetivo,
          consecucion:
            objetivo && objetivo > 0 ? Math.round((vendido / objetivo) * 1000) / 10 : null,
        };
      })
      .filter((f) => f.objetivo !== null);

    return NextResponse.json({
      mes,
      preciosActivos: preciosOn,
      propio,
      sede,
      porArticulo,
      porGrupo,
      importePropio: preciosOn
        ? porArticulo.reduce((n, f) => n + (f.importe ?? 0), 0)
        : null,
    });
  }),
);
