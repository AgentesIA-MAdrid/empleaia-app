/**
 * Lecturas de caja del módulo "Cierre de turno" — compartidas por arqueos y
 * conciliación (y por el aviso de recogida).
 *
 * Convención del repo: cero fetch interno entre rutas; la lógica compartida
 * vive en `src/lib/` y recibe el cliente Prisma inyectado.
 */

import type { PrismaClient } from "@/generated/prisma-tenant/client";

/** Un día en milisegundos. Las fechas del módulo son DATE a medianoche UTC. */
const DIA_MS = 86_400_000;

/** Convierte un rango inclusivo de días en el `[desde, hasta)` que usa Prisma. */
export function rangoExclusivo(desde: Date, hastaInclusive: Date): { gte: Date; lt: Date } {
  return { gte: desde, lt: new Date(hastaInclusive.getTime() + DIA_MS) };
}

/**
 * Efectivo y tarjeta declarados en los cierres de caja de un periodo.
 *
 * Solo cuenta cajas **confirmadas**: un borrador a medias no es un dato con el
 * que cuadrar un arqueo, y colarlo haría aparecer y desaparecer descuadres
 * según el momento en que se mire.
 */
export async function totalesCaja(
  prisma: PrismaClient,
  args: { desde: Date; hasta: Date; tiendaId?: string | null; soloConfirmadas?: boolean },
): Promise<{ efectivo: number; tarjeta: number; cajas: number }> {
  const r = await prisma.cierreCaja.aggregate({
    where: {
      fecha: rangoExclusivo(args.desde, args.hasta),
      ...(args.tiendaId ? { tiendaId: args.tiendaId } : {}),
      ...(args.soloConfirmadas === false ? {} : { confirmadoEn: { not: null } }),
    },
    _sum: { efectivo: true, tarjeta: true },
    _count: true,
  });
  return {
    efectivo: Number(r._sum.efectivo ?? 0),
    tarjeta: Number(r._sum.tarjeta ?? 0),
    cajas: r._count,
  };
}

/** Lo mismo, agrupado por sede: es como se pinta la conciliación. */
export async function totalesCajaPorSede(
  prisma: PrismaClient,
  args: { desde: Date; hasta: Date; tiendaId?: string | null },
): Promise<Map<string, { efectivo: number; tarjeta: number; cajas: number }>> {
  const filas = await prisma.cierreCaja.groupBy({
    by: ["tiendaId"],
    where: {
      fecha: rangoExclusivo(args.desde, args.hasta),
      confirmadoEn: { not: null },
      ...(args.tiendaId ? { tiendaId: args.tiendaId } : {}),
    },
    _sum: { efectivo: true, tarjeta: true },
    _count: true,
  });
  return new Map(
    filas.map((f) => [
      f.tiendaId ?? "",
      {
        efectivo: Number(f._sum.efectivo ?? 0),
        tarjeta: Number(f._sum.tarjeta ?? 0),
        cajas: f._count,
      },
    ]),
  );
}

/** Umbral de descuadre del cliente (1 € si no lo ha tocado). */
export async function umbralDescuadre(prisma: PrismaClient): Promise<number> {
  const cfg = await prisma.configuracionEmpresa.findUnique({
    where: { id: "singleton" },
    select: { descuadreUmbral: true },
  });
  const v = cfg?.descuadreUmbral === undefined || cfg?.descuadreUmbral === null ? 1 : Number(cfg.descuadreUmbral);
  return Number.isFinite(v) && v >= 0 ? v : 1;
}
