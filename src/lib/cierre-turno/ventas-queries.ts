/**
 * Lectura de ventas del módulo "Cierre de turno" — compartida por:
 *  - GET /api/objetivos-venta (consecución del mes)
 *  - GET /api/cierre-turno/progreso (paso 2 del asistente)
 *  - GET /api/informes/ventas (informe de ventas)
 *
 * Convención del repo: nada de fetch interno entre rutas del mismo proceso; la
 * lógica compartida vive en `src/lib/` y recibe el cliente Prisma inyectado
 * (ver `src/lib/informes/queries.ts`).
 *
 * El agregado se hace en SQL con `groupBy`: un mes de una cadena con 30
 * comerciales son decenas de miles de filas de venta y traerlas al proceso para
 * sumarlas en JavaScript no escala.
 */

import type { PrismaClient } from "@/generated/prisma-tenant/client";
import { rangoMes, type VentaAgregada, type VentaDia } from "@/lib/cierre-turno/objetivos";

export interface FiltroVentas {
  /** Mes "YYYY-MM". Alternativa a desde/hasta. */
  mes?: string;
  /** Rango explícito `[desde, hasta)`, para los informes. */
  desde?: Date;
  hasta?: Date;
  /** Limita a una sede (la del coordinador, o el filtro del informe). */
  tiendaId?: string | null;
  /**
   * Limita a un conjunto de sedes (las que coordina quien mira — ticket 73).
   * Se cruza con `tiendaId` si vienen los dos, así que un coordinador que pide
   * una sede ajena no ve nada en vez de verlo todo.
   */
  tiendaIds?: string[] | null;
  /** Limita a un comercial. */
  userId?: string | null;
  /**
   * Limita a un conjunto de comerciales, sin mirar la sede (ticket 4e81b6c3).
   * Es lo que hace falta para el objetivo INDIVIDUAL de alguien que ha cubierto
   * en otra tienda: sus ventas de ese día son de aquella tienda, pero suman en
   * su propia cuenta igual.
   */
  userIds?: string[] | null;
}

/**
 * Une dos lecturas de ventas sin contar nada dos veces: la clave de una venta
 * agregada es (comercial, sede, artículo), así que lo que aparezca en las dos
 * listas es la MISMA venta, no dos.
 */
export function fusionarVentas(...listas: VentaAgregada[][]): VentaAgregada[] {
  const acc = new Map<string, VentaAgregada>();
  for (const lista of listas) {
    for (const v of lista) {
      acc.set(`${v.userId}|${v.tiendaId ?? ""}|${v.articuloId ?? ""}`, v);
    }
  }
  return [...acc.values()];
}

function ventanaDe(f: FiltroVentas): { desde: Date; hasta: Date } {
  if (f.mes) return rangoMes(f.mes);
  if (f.desde && f.hasta) return { desde: f.desde, hasta: f.hasta };
  throw new Error("La lectura de ventas necesita un mes o un rango de fechas");
}

/** Ventas del periodo agrupadas por comercial, sede y artículo. */
export async function ventasAgregadas(
  prisma: PrismaClient,
  filtro: FiltroVentas,
): Promise<VentaAgregada[]> {
  // Se colapsan las filas del mismo (comercial, sede, artículo): un comercial
  // vende el mismo artículo muchos días del mes y a los objetivos les da igual
  // el día. Quien sí necesita el día es el seguimiento (`ventasPorDia`).
  const acc = new Map<string, VentaAgregada>();
  for (const v of await ventasPorDia(prisma, filtro)) {
    const clave = `${v.userId}|${v.tiendaId ?? ""}|${v.articuloId ?? ""}`;
    const previo = acc.get(clave);
    if (previo) previo.cantidad += v.cantidad;
    else
      acc.set(clave, {
        userId: v.userId,
        tiendaId: v.tiendaId,
        articuloId: v.articuloId,
        cantidad: v.cantidad,
      });
  }
  return [...acc.values()];
}

/**
 * Lo mismo, pero conservando el día del cierre: es lo que necesita el
 * seguimiento diario de objetivos (`/api/objetivos-venta/seguimiento`) para
 * enseñar el día a día y el acumulado frente al objetivo repartido.
 *
 * Se agrupa por `CierreTurnoVenta.cierreId` porque la sede, el comercial y el
 * día viven en `CierreTurno` y Prisma no agrupa por campos de la relación: se
 * agrupa por cierre y se resuelven con un segundo `findMany` de cierres (una
 * fila por comercial y día, mucho menos volumen que las ventas).
 */
export async function ventasPorDia(
  prisma: PrismaClient,
  filtro: FiltroVentas,
): Promise<VentaDia[]> {
  const { desde, hasta } = ventanaDe(filtro);

  const cierres = await prisma.cierreTurno.findMany({
    where: {
      fecha: { gte: desde, lt: hasta },
      // Los dos filtros de sede se acumulan en un AND: si el coordinador pide
      // una sede que no lleva, el cruce se queda vacío. Un `...(x ? {} : {})`
      // por separado dejaría que el segundo sobreescribiera al primero.
      ...(filtro.tiendaId || filtro.tiendaIds
        ? {
            AND: [
              ...(filtro.tiendaId ? [{ tiendaId: filtro.tiendaId }] : []),
              ...(filtro.tiendaIds ? [{ tiendaId: { in: filtro.tiendaIds } }] : []),
            ],
          }
        : {}),
      ...(filtro.userId ? { userId: filtro.userId } : {}),
      ...(filtro.userIds ? { userId: { in: filtro.userIds } } : {}),
    },
    select: { id: true, userId: true, tiendaId: true, fecha: true },
  });
  if (cierres.length === 0) return [];

  const porCierre = new Map(cierres.map((c) => [c.id, c]));

  const filas = await prisma.cierreTurnoVenta.groupBy({
    by: ["cierreId", "articuloId"],
    where: { cierreId: { in: cierres.map((c) => c.id) } },
    _sum: { cantidad: true },
  });

  // Se colapsan las filas del mismo (día, comercial, sede, artículo): una misma
  // persona puede tener más de un cierre el mismo día (jornada partida) y el
  // seguimiento cuenta el día, no el cierre.
  const acc = new Map<string, VentaDia>();
  for (const f of filas) {
    const c = porCierre.get(f.cierreId);
    if (!c) continue;
    // `fecha` es un DATE a medianoche UTC: el recorte a 10 caracteres da el día
    // tal cual se guardó, sin que la zona horaria lo mueva.
    const fecha = c.fecha.toISOString().slice(0, 10);
    const clave = `${fecha}|${c.userId}|${c.tiendaId ?? ""}|${f.articuloId ?? ""}`;
    const previo = acc.get(clave);
    const cantidad = f._sum.cantidad ?? 0;
    if (previo) previo.cantidad += cantidad;
    else
      acc.set(clave, {
        fecha,
        userId: c.userId,
        tiendaId: c.tiendaId,
        articuloId: f.articuloId,
        cantidad,
      });
  }
  return [...acc.values()];
}

/** Precio por artículo, para leer las ventas en euros. */
export async function preciosPorArticulo(prisma: PrismaClient): Promise<Map<string, number | null>> {
  const articulos = await prisma.articuloVenta.findMany({ select: { id: true, precio: true } });
  return new Map(articulos.map((a) => [a.id, a.precio === null ? null : Number(a.precio)]));
}

/** ¿Este cliente trabaja con precios? */
export async function preciosActivos(prisma: PrismaClient): Promise<boolean> {
  const cfg = await prisma.configuracionEmpresa.findUnique({
    where: { id: "singleton" },
    select: { ventasPreciosActivos: true },
  });
  return cfg?.ventasPreciosActivos ?? false;
}
