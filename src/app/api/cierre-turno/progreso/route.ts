/**
 * GET /api/cierre-turno/progreso — paso 2 del asistente ("Cómo vas").
 *
 * Del mes en curso, los TRES objetivos que le afectan al comercial, cada uno
 * con su total y su desglose por grupo de productos (ticket 8f2a04e1):
 *
 *  1. El suyo.
 *  2. El de su sede.
 *  3. El que el operador impone a su sede ("TMT"), otra vara sobre las mismas
 *     ventas de la tienda.
 *
 * Es de lectura y de uno mismo: no hace falta rol especial, cada quien ve lo
 * suyo y el total de su sede (que ya ve en el cuadrante y en los cierres de su
 * tienda).
 *
 * La sede va con su NOMBRE, no como "tu sede": hay quien cubre en varias y lo
 * primero que necesita saber es de qué tienda le están hablando.
 *
 * Y la sede es la que ha CONFIRMADO al empezar el cierre de hoy, no la de su
 * ficha (ticket 8c05f3e1): un correturnos no tiene ninguna en la ficha y veía
 * los dos cuadros de tienda vacíos con un "no tienes sede asignada", estando de
 * hecho trabajando en una.
 *
 * Salen TODOS los grupos del catálogo, tengan objetivo o no y haya vendido o
 * no: la lista es corta —una fila por subcategoría— y enseñar solo lo vendido
 * escondía justo lo que va flojo, que es lo que hay que mirar.
 *
 * Sin objetivo fijado no se devuelve un cero: se dice que no hay objetivo. Un
 * "0 % conseguido" cuando nadie ha puesto objetivo desanima por un dato que no
 * existe.
 *
 * En el desglose por producto, los que se llaman igual van en una sola fila con
 * las unidades sumadas aunque el catálogo los tenga en categorías distintas
 * (ticket 7dd7ac00): al comercial se le pide "vende 3 fibras", no "3 fibras de
 * particular", y las cifras de arriba ya las cuentan juntas.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid } from "@/lib/cierre-turno/core";
import {
  agruparProductosPorNombre,
  anotarVentas,
  cuentaParaObjetivos,
  esDelSubgrupo,
  etiquetaSubgrupo,
  fuenteDe,
  normalizarMes,
  progresoDe,
  subgruposDelCatalogo,
  vendidoDeSujeto,
  type FuenteObjetivo,
  type ObjetivoFila,
  type VentaAgregada,
} from "@/lib/cierre-turno/objetivos";
import {
  preciosActivos as leerPreciosActivos,
  ventasAgregadas,
} from "@/lib/cierre-turno/ventas-queries";

/** Consecución con la regla del módulo: sin objetivo no hay nada que medir. */
function pct(vendido: number, objetivo: number | null): number | null {
  if (objetivo === null || objetivo <= 0) return null;
  return Math.round((vendido / objetivo) * 1000) / 10;
}

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaFicha = ((session.user as any).tiendaId as string | null) ?? null;

    // La que confirmó al abrir el cierre manda sobre la de su ficha.
    const cierreHoy = await prisma.cierreTurno.findUnique({
      where: { userId_fecha: { userId, fecha: new Date(`${diaMadrid()}T00:00:00Z`) } },
      select: { tiendaId: true },
    });
    const tiendaId = cierreHoy?.tiendaId ?? tiendaFicha;

    const mesPedido = new URL(req.url).searchParams.get("mes") ?? diaMadrid().slice(0, 7);
    const mesOk = normalizarMes(mesPedido);
    if (!mesOk.ok) return NextResponse.json({ error: mesOk.error }, { status: 400 });
    const mes = mesOk.mes;

    const [objetivos, ventasBrutas, articulos, tienda, preciosOn] = await Promise.all([
      prisma.objetivoVenta.findMany({
        where: {
          mes,
          // Solo lo que le afecta: sus objetivos y los de su sede (los dos
          // juegos de la sede, el de la empresa y el del operador).
          OR: [{ userId }, ...(tiendaId ? [{ tiendaId }] : [])],
        },
        select: {
          id: true,
          mes: true,
          userId: true,
          tiendaId: true,
          articuloId: true,
          categoria: true,
          subcategoria: true,
          fuente: true,
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
        select: {
          id: true,
          nombre: true,
          categoria: true,
          subcategoria: true,
          precio: true,
          cuentaParaObjetivos: true,
        },
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      }),
      // El nombre de la tienda, para no llamarla "tu sede".
      tiendaId
        ? prisma.tienda.findUnique({ where: { id: tiendaId }, select: { nombre: true } })
        : Promise.resolve(null),
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

    const paraObjetivos = articulos.filter((a) => cuentaParaObjetivos(a));
    const articuloIds = paraObjetivos.map((a) => a.id);
    const subgrupos = subgruposDelCatalogo(paraObjetivos);

    /**
     * Un bloque de la pantalla: el total del mes y una fila por grupo del
     * catálogo. Los tres se calculan igual; solo cambian a quién miran y de
     * quién es la cifra.
     */
    function bloque(args: {
      sujeto: { ambito: "comercial" | "sede"; id: string };
      ventasDelSujeto: VentaAgregada[];
      fuente: FuenteObjetivo;
    }) {
      const suyos = objetivos.filter((o: ObjetivoFila) => {
        if (fuenteDe(o) !== args.fuente) return false;
        return args.sujeto.ambito === "comercial"
          ? o.userId === args.sujeto.id
          : o.tiendaId === args.sujeto.id;
      });
      const total = progresoDe(suyos, args.ventasDelSujeto, args.sujeto, articuloIds, paraObjetivos);
      const grupos = subgrupos.map((g) => {
        const vendido = vendidoDeSujeto(args.ventasDelSujeto, args.sujeto, null, g);
        const objetivo = suyos.find((o) => o.subcategoria && esDelSubgrupo(o, g))?.cantidad ?? null;
        return {
          grupo: etiquetaSubgrupo(g),
          vendido,
          objetivo,
          consecucion: pct(vendido, objetivo),
        };
      });
      return { ...total, grupos };
    }

    const propio = bloque({
      sujeto: { ambito: "comercial", id: userId },
      ventasDelSujeto: ventasPropias,
      fuente: "propio",
    });
    const sede = tiendaId
      ? bloque({
          sujeto: { ambito: "sede", id: tiendaId },
          ventasDelSujeto: ventasSede,
          fuente: "propio",
        })
      : null;
    // La vara del operador: mismas ventas de la tienda, otras cifras.
    const sedeTmt = tiendaId
      ? bloque({
          sujeto: { ambito: "sede", id: tiendaId },
          ventasDelSujeto: ventasSede,
          fuente: "tmt",
        })
      : null;

    // Desglose de lo que lleva vendido él, producto a producto. Ya no lleva
    // objetivo —se fijan por grupo—, así que es el detalle de sus ventas.
    const porArticulo = agruparProductosPorNombre(
      articulos
        .map((a) => {
          const vendido = vendidoDeSujeto(ventasPropias, { ambito: "comercial", id: userId }, a.id);
          return {
            articuloId: a.id,
            nombre: a.nombre,
            vendido,
            objetivo: null,
            consecucion: null,
            importe:
              preciosOn && a.precio !== null
                ? Math.round(vendido * Number(a.precio) * 100) / 100
                : null,
            // Lo vendido de un producto excluido no suma en los objetivos; se
            // dice en la fila para que las dos cifras no parezcan reñidas.
            cuentaParaObjetivos: cuentaParaObjetivos(a),
            productos: 1,
          };
        })
        // Una lista de 80 artículos a cero no dice nada a nadie.
        .filter((f) => f.vendido > 0),
    );

    return NextResponse.json({
      mes,
      preciosActivos: preciosOn,
      sedeNombre: tienda?.nombre ?? null,
      propio,
      sede,
      sedeTmt,
      porArticulo,
      importePropio: preciosOn ? porArticulo.reduce((n, f) => n + (f.importe ?? 0), 0) : null,
    });
  }),
);
