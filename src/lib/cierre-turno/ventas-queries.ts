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
import { rangoMes, type VentaAgregada } from "@/lib/cierre-turno/objetivos";

export interface FiltroVentas {
  /** Mes "YYYY-MM". Alternativa a desde/hasta. */
  mes?: string;
  /** Rango explícito `[desde, hasta)`, para los informes. */
  desde?: Date;
  hasta?: Date;
  /** Limita a una sede (la del coordinador, o el filtro del informe). */
  tiendaId?: string | null;
  /** Limita a un comercial. */
  userId?: string | null;
}

function ventanaDe(f: FiltroVentas): { desde: Date; hasta: Date } {
  if (f.mes) return rangoMes(f.mes);
  if (f.desde && f.hasta) return { desde: f.desde, hasta: f.hasta };
  throw new Error("ventasAgregadas necesita un mes o un rango de fechas");
}

/**
 * Ventas agrupadas por comercial, sede y artículo.
 *
 * Se agrupa por `CierreTurnoVenta.cierreId` no: la sede y el comercial viven en
 * `CierreTurno`, así que hace falta el join. Prisma no agrupa por campos de la
 * relación, de modo que se agrupa por cierre y se resuelve la sede con un
 * segundo `findMany` de cierres (una fila por comercial y día, mucho menos
 * volumen que las ventas).
 */
export async function ventasAgregadas(
  prisma: PrismaClient,
  filtro: FiltroVentas,
): Promise<VentaAgregada[]> {
  const { desde, hasta } = ventanaDe(filtro);

  const cierres = await prisma.cierreTurno.findMany({
    where: {
      fecha: { gte: desde, lt: hasta },
      ...(filtro.tiendaId ? { tiendaId: filtro.tiendaId } : {}),
      ...(filtro.userId ? { userId: filtro.userId } : {}),
    },
    select: { id: true, userId: true, tiendaId: true },
  });
  if (cierres.length === 0) return [];

  const porCierre = new Map(cierres.map((c) => [c.id, c]));

  const filas = await prisma.cierreTurnoVenta.groupBy({
    by: ["cierreId", "articuloId"],
    where: { cierreId: { in: cierres.map((c) => c.id) } },
    _sum: { cantidad: true },
  });

  // Se colapsan las filas del mismo (comercial, sede, artículo): un comercial
  // vende el mismo artículo muchos días del mes y a los objetivos les da igual
  // el día.
  const acc = new Map<string, VentaAgregada>();
  for (const f of filas) {
    const c = porCierre.get(f.cierreId);
    if (!c) continue;
    const clave = `${c.userId}|${c.tiendaId ?? ""}|${f.articuloId ?? ""}`;
    const previo = acc.get(clave);
    const cantidad = f._sum.cantidad ?? 0;
    if (previo) previo.cantidad += cantidad;
    else
      acc.set(clave, {
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
