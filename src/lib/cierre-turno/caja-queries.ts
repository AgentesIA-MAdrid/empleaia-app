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
  args: { desde: Date; hasta: Date; tiendaId?: string | null; tiendaIds?: string[] | null },
): Promise<Map<string, { efectivo: number; tarjeta: number; cajas: number }>> {
  const filas = await prisma.cierreCaja.groupBy({
    by: ["tiendaId"],
    where: {
      fecha: rangoExclusivo(args.desde, args.hasta),
      confirmadoEn: { not: null },
      // Los dos filtros de sede se acumulan (ticket 73): quien coordina varias
      // sedes las pasa en `tiendaIds`, y si además pide una concreta, se cruzan.
      ...(args.tiendaId || args.tiendaIds
        ? {
            AND: [
              ...(args.tiendaId ? [{ tiendaId: args.tiendaId }] : []),
              ...(args.tiendaIds ? [{ tiendaId: { in: args.tiendaIds } }] : []),
            ],
          }
        : {}),
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

/**
 * El saldo de arranque de cada sede: el último `FondoCaja` registrado hasta esa
 * fecha (ticket 5f0a92c7).
 *
 * Es de dónde arranca la cuenta del acumulado. Al principio lo carga
 * administración desde su Excel (lo que ya había en el cajón al estrenar el
 * sistema) y, a partir de ahí, lo deja a cero cada arqueo declarado.
 *
 * Ojo: pese al nombre de la tabla, esto NO es el fondo de cambio —ese es fijo,
 * igual en todas las tiendas y no entra en ninguna cuenta—.
 */
export async function arranquePorSede(
  prisma: PrismaClient,
  args: { antesDe: Date; tiendaIds?: string[] | null },
): Promise<Map<string, { fecha: Date; importe: number | null; incidencia: string | null }>> {
  const filas = await prisma.fondoCaja.findMany({
    where: {
      // Estrictamente anterior al último día del periodo: el cero que deja el
      // arqueo del domingo lleva la fecha de ESE domingo, y es el arranque de la
      // semana siguiente, no el de la que se acaba de arquear.
      fecha: { lt: args.antesDe },
      ...(args.tiendaIds ? { tiendaId: { in: args.tiendaIds } } : {}),
    },
    select: { tiendaId: true, fecha: true, importe: true, incidencia: true },
    // `distinct` sobre un orden descendente por fecha deja, de cada sede, su
    // saldo más reciente: el que manda si hay varios registrados.
    orderBy: [{ tiendaId: "asc" }, { fecha: "desc" }],
    distinct: ["tiendaId"],
  });
  return new Map(
    filas.map((f) => [
      f.tiendaId,
      {
        fecha: f.fecha,
        importe: f.importe === null ? null : Number(f.importe),
        incidencia: f.incidencia,
      },
    ]),
  );
}

/**
 * Efectivo cobrado por cada sede DESDE su propio arranque y hasta el día que se
 * pida. Cada sede puede tener el arranque a una fecha distinta, así que se traen
 * los cierres por día y se suman los que caen después. Una consulta, no una por
 * tienda.
 */
export async function cobradoDesdeArranque(
  prisma: PrismaClient,
  args: {
    arranques: Map<string, { fecha: Date }>;
    /** Último día del periodo consultado (inclusive). */
    hasta: Date;
    tiendaIds?: string[] | null;
  },
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (args.arranques.size === 0) return out;

  // El día más antiguo que le interesa a alguna sede.
  const minFecha = new Date(
    Math.min(...[...args.arranques.values()].map((a) => a.fecha.getTime())),
  );

  const cierres = await prisma.cierreCaja.groupBy({
    by: ["tiendaId", "fecha"],
    where: {
      fecha: { gt: minFecha, lt: new Date(args.hasta.getTime() + DIA_MS) },
      confirmadoEn: { not: null },
      ...(args.tiendaIds ? { tiendaId: { in: args.tiendaIds } } : {}),
    },
    _sum: { efectivo: true },
  });

  for (const c of cierres) {
    const tiendaId = c.tiendaId ?? "";
    const arranque = args.arranques.get(tiendaId);
    // El arranque es el saldo AL CERRAR su día: lo de ese mismo día ya está dentro.
    if (!arranque || c.fecha <= arranque.fecha) continue;
    const previo = out.get(tiendaId) ?? 0;
    out.set(tiendaId, Math.round((previo + Number(c._sum.efectivo ?? 0)) * 100) / 100);
  }

  return out;
}

/**
 * El acumulado de UNA sede a una fecha. Es la misma cuenta que hace la pantalla
 * de arqueos, para quien declara y para quien firma la recogida: los tres tienen
 * que ver el mismo número.
 */
export async function acumuladoDeSede(
  prisma: PrismaClient,
  args: { tiendaId: string; hasta: Date },
): Promise<import("./saldo-caja").SaldoCaja> {
  const { acumuladoEnCaja } = await import("./saldo-caja");
  const arranques = await arranquePorSede(prisma, {
    antesDe: args.hasta,
    tiendaIds: [args.tiendaId],
  });
  const cobrado = await cobradoDesdeArranque(prisma, {
    arranques,
    hasta: args.hasta,
    tiendaIds: [args.tiendaId],
  });
  return acumuladoEnCaja({
    arranque: arranques.get(args.tiendaId) ?? null,
    cobrado: cobrado.get(args.tiendaId) ?? 0,
  });
}
