/**
 * Lógica pura de las solicitudes de fichaje (olvido / corrección de hora).
 *
 * Sin dependencias de Prisma ni de red — testeable en aislamiento. Los
 * route handlers la usan para validar el payload, decidir autorización y
 * construir los datos del `Fichaje` resultante al aprobar.
 */

import type { TipoFichaje } from "@/generated/prisma-tenant/client";

export type ClaseSolicitud = "olvido" | "correccion";

const TIPOS_VALIDOS: readonly TipoFichaje[] = [
  "ENTRADA",
  "PAUSA",
  "VUELTA_PAUSA",
  "SALIDA",
] as const;

/**
 * ¿Puede un usuario con este rol/tienda resolver (aprobar/rechazar) una
 * solicitud cuyo solicitante pertenece a `solicitanteTiendaId`?
 *
 * - OWNER: siempre.
 * - MANAGER: solo si comparte tienda con el solicitante.
 * - EMPLEADO u otros: nunca.
 */
export function puedeResolverSolicitud(
  rol: string,
  resolverTiendaId: string | null | undefined,
  solicitanteTiendaId: string | null | undefined,
): boolean {
  if (rol === "OWNER") return true;
  if (rol === "MANAGER") {
    return !!resolverTiendaId && resolverTiendaId === solicitanteTiendaId;
  }
  return false;
}

export interface SolicitudNormalizada {
  clase: ClaseSolicitud;
  tipo: TipoFichaje;
  fechaHora: Date;
  motivo: string;
  fichajeId: string | null;
}

export type Resultado<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Valida y normaliza el payload de creación de una solicitud.
 * `ahora` se inyecta para testear el rechazo de horas futuras.
 */
export function normalizarCrearSolicitud(
  input: {
    clase?: unknown;
    tipo?: unknown;
    fechaHora?: unknown;
    motivo?: unknown;
    fichajeId?: unknown;
  },
  ahora: Date = new Date(),
): Resultado<SolicitudNormalizada> {
  const clase = input.clase === "correccion" ? "correccion" : "olvido";

  const tipo = input.tipo;
  if (typeof tipo !== "string" || !TIPOS_VALIDOS.includes(tipo as TipoFichaje)) {
    return { ok: false, error: "Tipo de fichaje no válido" };
  }

  if (typeof input.fechaHora !== "string" && !(input.fechaHora instanceof Date)) {
    return { ok: false, error: "Falta la fecha y hora" };
  }
  const fechaHora = new Date(input.fechaHora as string | Date);
  if (Number.isNaN(fechaHora.getTime())) {
    return { ok: false, error: "Fecha y hora no válidas" };
  }
  // Un fichaje no puede ser en el futuro (margen de 5 min por desfase de reloj).
  if (fechaHora.getTime() > ahora.getTime() + 5 * 60 * 1000) {
    return { ok: false, error: "La hora no puede ser futura" };
  }

  const motivo = typeof input.motivo === "string" ? input.motivo.trim() : "";
  if (motivo.length < 3) {
    return { ok: false, error: "Indica un motivo (mínimo 3 caracteres)" };
  }

  let fichajeId: string | null = null;
  if (clase === "correccion") {
    if (typeof input.fichajeId !== "string" || !input.fichajeId) {
      return { ok: false, error: "Falta el fichaje a corregir" };
    }
    fichajeId = input.fichajeId;
  }

  return { ok: true, data: { clase, tipo: tipo as TipoFichaje, fechaHora, motivo, fichajeId } };
}

/**
 * Datos para crear un Fichaje nuevo al aprobar una solicitud de "olvido".
 */
export function buildFichajeCreate(opts: {
  solicitanteId: string;
  tiendaId: string | null;
  tipo: TipoFichaje;
  fechaHora: Date;
  resolverId: string;
  nota: string;
}) {
  return {
    userId: opts.solicitanteId,
    tiendaId: opts.tiendaId,
    tipo: opts.tipo,
    timestamp: opts.fechaHora,
    metodo: "MANUAL" as const,
    editadoPor: opts.resolverId,
    editadoEn: new Date(),
    nota: opts.nota,
  };
}

/**
 * Datos para actualizar un Fichaje existente al aprobar una "corrección".
 */
export function buildFichajeUpdate(opts: {
  tipo: TipoFichaje;
  fechaHora: Date;
  resolverId: string;
  nota: string;
}) {
  return {
    tipo: opts.tipo,
    timestamp: opts.fechaHora,
    metodo: "MANUAL" as const,
    editadoPor: opts.resolverId,
    editadoEn: new Date(),
    nota: opts.nota,
  };
}

/** Nota legible que queda en el Fichaje creado/editado. */
export function notaFichaje(motivo: string, resolverNombre: string): string {
  return `Solicitud de fichaje aprobada por ${resolverNombre}. Motivo: ${motivo}`;
}
