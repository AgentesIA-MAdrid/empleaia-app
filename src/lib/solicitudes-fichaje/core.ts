/**
 * Lógica pura de las solicitudes de fichaje (olvido / corrección de hora).
 *
 * Sin dependencias de Prisma ni de red — testeable en aislamiento. Los
 * route handlers la usan para validar el payload, decidir autorización y
 * construir los datos del `Fichaje` resultante al aprobar.
 */

import type { TipoFichaje } from "@/generated/prisma-tenant/client";

/**
 * - "olvido": registrar un fichaje que no existía.
 * - "correccion": corregir la hora de un fichaje existente.
 * - "fuera_sede": el empleado intentó fichar fuera del radio de una sede con
 *   `exigirFichajeEnSede`. El fichaje directo se rechazó, así que registra el
 *   intento con su motivo y su geolocalización para que un OWNER lo apruebe.
 */
export type ClaseSolicitud = "olvido" | "correccion" | "fuera_sede";

const TIPOS_VALIDOS: readonly TipoFichaje[] = [
  "ENTRADA",
  "PAUSA",
  "VUELTA_PAUSA",
  "SALIDA",
] as const;

/**
 * ¿Puede un usuario con este rol resolver (aprobar/rechazar) una solicitud
 * de fichaje por su ROL?
 *
 * - OWNER (Administrador): siempre.
 * - Resto (Coordinador/MANAGER, Empleado): no por rol. El Coordinador tiene
 *   permisos de empleado en escritura y ya no aprueba fichajes de su centro.
 *
 * Nota: independientemente del rol, el "coordinador designado" de una
 * solicitud (su `aprobadorId`) sí puede resolverla; eso lo comprueba el
 * handler por separado, no depende del rol.
 */
export function puedeResolverSolicitud(rol: string): boolean {
  return rol === "OWNER";
}

export interface SolicitudNormalizada {
  clase: ClaseSolicitud;
  tipo: TipoFichaje;
  fechaHora: Date;
  motivo: string;
  fichajeId: string | null;
  /** Solo en clase "fuera_sede"; null en el resto. */
  latitud: number | null;
  longitud: number | null;
  distancia: number | null;
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
    latitud?: unknown;
    longitud?: unknown;
    distancia?: unknown;
  },
  ahora: Date = new Date(),
): Resultado<SolicitudNormalizada> {
  const clase: ClaseSolicitud =
    input.clase === "correccion" ? "correccion"
    : input.clase === "fuera_sede" ? "fuera_sede"
    : "olvido";

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

  // Geo solo en "fuera_sede": es la prueba de dónde se intentó fichar. Sin
  // coordenadas la solicitud no tendría sentido (el servidor rechazó el
  // fichaje precisamente por la distancia).
  let latitud: number | null = null;
  let longitud: number | null = null;
  let distancia: number | null = null;
  if (clase === "fuera_sede") {
    const lat = numeroFinito(input.latitud);
    const lon = numeroFinito(input.longitud);
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return { ok: false, error: "Faltan las coordenadas del intento de fichaje" };
    }
    latitud = lat;
    longitud = lon;
    const d = numeroFinito(input.distancia);
    // La distancia se recalcula en el servidor antes de guardar; lo que llegue
    // aquí es orientativo y solo se acepta si es un metraje plausible.
    distancia = d !== null && d >= 0 ? Math.round(d) : null;
  }

  return {
    ok: true,
    data: { clase, tipo: tipo as TipoFichaje, fechaHora, motivo, fichajeId, latitud, longitud, distancia },
  };
}

function numeroFinito(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
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
  /** Solo en "fuera_sede": conserva dónde se fichó realmente. */
  latitud?: number | null;
  longitud?: number | null;
  distancia?: number | null;
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
    latitud: opts.latitud ?? null,
    longitud: opts.longitud ?? null,
    distancia: opts.distancia ?? null,
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
export function notaFichaje(motivo: string, resolverNombre: string, clase: ClaseSolicitud = "olvido"): string {
  const cabecera =
    clase === "fuera_sede"
      ? `Fichaje fuera de la sede aprobado por ${resolverNombre}`
      : `Solicitud de fichaje aprobada por ${resolverNombre}`;
  return `${cabecera}. Motivo: ${motivo}`;
}
