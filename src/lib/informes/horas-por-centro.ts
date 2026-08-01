/**
 * Horas por empleado y centro (sede) en un periodo, con dos orígenes:
 *
 *  - `fichajes` (horas reales): empareja cada ENTRADA/VUELTA_PAUSA con la
 *    siguiente PAUSA/SALIDA del mismo empleado y atribuye los minutos a la
 *    sede donde fichó la entrada.
 *  - `cuadrante` (horas planificadas): suma las horas de cada turno del
 *    cuadrante y las atribuye a la sede del turno. Cuenta igual que la
 *    pantalla de Turnos y su export a Excel porque comparte `horasDeTurno`.
 *
 * En ambos casos las filas se enriquecen con las horas de contrato del
 * empleado prorrateadas al periodo y la diferencia contra lo contabilizado,
 * que es lo que permite ver de un vistazo las horas extra (o el déficit).
 *
 * Funciones puras (reciben el cliente Prisma) → testeables sin red ni BD real.
 */

import type { PrismaClient } from "@/generated/prisma-tenant/client";
import { horasDeTurno, type TurnoLite } from "@/lib/turnos/horas";
import {
  diasDelPeriodo,
  diferenciaContrato,
  horasContratoPeriodo,
  horasSemanalesDe,
  type HorasContratoRaw,
} from "@/lib/informes/horas-contrato";

/** De dónde salen las horas del informe. */
export type OrigenHorasCentro = "fichajes" | "cuadrante";

export const ORIGENES_HORAS_CENTRO: readonly OrigenHorasCentro[] = [
  "fichajes",
  "cuadrante",
];

export interface FilaHorasCentro {
  userId: string;
  empleado: string;
  tiendaId: string | null;
  centro: string;
  minutos: number;
  horas: number;
}

/**
 * Fila del informe con la comparación contra el contrato del empleado.
 *
 * `horasContrato` y `diferencia` son de la PERSONA, no de la sede: el
 * contrato es global (mismo criterio que la columna "Contrato" del
 * cuadrante). Por eso la diferencia se mide contra `horasTotales` (todos
 * sus centros) y sale igual en todas las filas del mismo empleado: quien
 * reparte su jornada entre dos sedes no debe aparecer como deficitario en
 * cada una.
 */
export interface FilaHorasCentroConContrato extends FilaHorasCentro {
  /** Horas del empleado en el periodo sumando TODOS los centros. */
  horasTotales: number;
  /** Horas de contrato imputables al periodo (contrato semanal prorrateado). */
  horasContrato: number;
  /** `horasTotales − horasContrato`. Positiva = horas extra. */
  diferencia: number;
}

interface FichajeMin {
  userId: string;
  tiendaId: string | null;
  tipo: string;
  timestamp: Date;
  user: { nombre: string; apellidos: string };
  tienda: { nombre: string } | null;
}

/** Calcula los minutos trabajados por (empleado, centro) a partir de fichajes ya ordenables. */
export function agregarHorasPorCentro(fichajes: FichajeMin[]): FilaHorasCentro[] {
  // Ordena por empleado y luego por hora.
  const orden = [...fichajes].sort((a, b) =>
    a.userId === b.userId
      ? a.timestamp.getTime() - b.timestamp.getTime()
      : a.userId.localeCompare(b.userId),
  );

  // acc[userId|tiendaId] -> { minutos, empleado, centro, tiendaId, userId }
  const acc = new Map<string, FilaHorasCentro>();
  const meta = new Map<string, { empleado: string; centroPorTienda: Map<string, string> }>();

  let abierto: { userId: string; time: number; tiendaId: string | null } | null = null;

  for (const f of orden) {
    // Registra metadatos del empleado/centro para las etiquetas.
    if (!meta.has(f.userId)) {
      meta.set(f.userId, {
        empleado: `${f.user.nombre} ${f.user.apellidos}`.trim(),
        centroPorTienda: new Map(),
      });
    }
    if (f.tiendaId && f.tienda) {
      meta.get(f.userId)!.centroPorTienda.set(f.tiendaId, f.tienda.nombre);
    }

    const esApertura = f.tipo === "ENTRADA" || f.tipo === "VUELTA_PAUSA";
    const esCierre = f.tipo === "PAUSA" || f.tipo === "SALIDA";

    if (esApertura) {
      abierto = { userId: f.userId, time: f.timestamp.getTime(), tiendaId: f.tiendaId };
    } else if (esCierre && abierto && abierto.userId === f.userId) {
      const min = Math.max(0, Math.round((f.timestamp.getTime() - abierto.time) / 60000));
      const tiendaId = abierto.tiendaId;
      const key = `${f.userId}::${tiendaId ?? "sin"}`;
      const empleado = meta.get(f.userId)!.empleado;
      const centro =
        tiendaId ? (meta.get(f.userId)!.centroPorTienda.get(tiendaId) ?? "—") : "Sin sede";
      const fila = acc.get(key);
      if (fila) fila.minutos += min;
      else acc.set(key, { userId: f.userId, empleado, tiendaId, centro, minutos: min, horas: 0 });
      abierto = null;
    }
  }

  return [...acc.values()]
    .map((f) => ({ ...f, horas: Math.round((f.minutos / 60) * 100) / 100 }))
    .sort((a, b) => a.empleado.localeCompare(b.empleado, "es") || a.centro.localeCompare(b.centro, "es"));
}

/**
 * Añade a cada fila el total del empleado, sus horas de contrato en el
 * periodo y la diferencia entre ambas (lo que el cliente necesita para
 * calcular horas extra). Función pura: recibe ya resueltos el contrato de
 * cada persona y el de la empresa.
 */
export function enriquecerConContrato(
  filas: FilaHorasCentro[],
  opts: {
    /** userId → `User.horasSemanalesContrato` (null = usar el de la empresa). */
    horasSemanalesPorUsuario: Map<string, HorasContratoRaw>;
    /** `ConfiguracionEmpresa.horasSemanales`. */
    horasSemanalesEmpresa: number | null;
    /** Días naturales del periodo, para prorratear el contrato semanal. */
    dias: number;
    /**
     * Filas del empleado SIN filtro de sede. Solo hace falta cuando el
     * informe está filtrado por una sede: el total contra el que se mide el
     * contrato debe seguir siendo el de todas. Si se omite, se usan `filas`.
     */
    filasGlobales?: FilaHorasCentro[];
  },
): FilaHorasCentroConContrato[] {
  const { horasSemanalesPorUsuario, horasSemanalesEmpresa, dias } = opts;
  // Total del empleado en minutos (todas sus sedes) antes de redondear a
  // horas: sumar los `horas` ya redondeados de cada fila arrastra error.
  const minutosPorUsuario = new Map<string, number>();
  for (const f of opts.filasGlobales ?? filas) {
    minutosPorUsuario.set(f.userId, (minutosPorUsuario.get(f.userId) ?? 0) + f.minutos);
  }
  return filas.map((f) => {
    const horasTotales =
      Math.round(((minutosPorUsuario.get(f.userId) ?? 0) / 60) * 100) / 100;
    const horasContrato = horasContratoPeriodo(
      horasSemanalesDe(horasSemanalesPorUsuario.get(f.userId), horasSemanalesEmpresa),
      dias,
    );
    return {
      ...f,
      horasTotales,
      horasContrato,
      diferencia: diferenciaContrato(horasTotales, horasContrato),
    };
  });
}

/** Lee de BD el contrato de cada empleado de las filas y el de la empresa. */
async function cargarContratos(
  prisma: PrismaClient,
  userIds: string[],
): Promise<{
  horasSemanalesPorUsuario: Map<string, HorasContratoRaw>;
  horasSemanalesEmpresa: number | null;
}> {
  if (userIds.length === 0) {
    return { horasSemanalesPorUsuario: new Map(), horasSemanalesEmpresa: null };
  }
  const [empleados, config] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, horasSemanalesContrato: true },
    }),
    prisma.configuracionEmpresa.findFirst({ select: { horasSemanales: true } }),
  ]);
  return {
    horasSemanalesPorUsuario: new Map(
      empleados.map((e) => [e.id, e.horasSemanalesContrato as HorasContratoRaw]),
    ),
    horasSemanalesEmpresa: config?.horasSemanales ?? null,
  };
}

/**
 * Enriquece las filas agregadas con el contrato (una query extra).
 *
 * `filasGlobales` (las mismas filas sin filtro de sede) llega solo cuando el
 * informe está filtrado: el contrato es de la persona, no de la sede.
 */
async function conContrato(
  prisma: PrismaClient,
  filas: FilaHorasCentro[],
  filasGlobales: FilaHorasCentro[],
  fechaInicio: Date,
  fechaFin: Date,
): Promise<FilaHorasCentroConContrato[]> {
  const contratos = await cargarContratos(prisma, [
    ...new Set(filas.map((f) => f.userId)),
  ]);
  return enriquecerConContrato(filas, {
    ...contratos,
    dias: diasDelPeriodo(fechaInicio, fechaFin),
    filasGlobales,
  });
}

/** Lee los fichajes del periodo con el scope pedido. */
async function leerFichajes(
  prisma: PrismaClient,
  fechaInicio: Date,
  fechaFin: Date,
  tiendaId: string | null,
  userIds?: string[],
): Promise<FichajeMin[]> {
  const fichajes = await prisma.fichaje.findMany({
    where: {
      timestamp: { gte: fechaInicio, lte: fechaFin },
      ...(tiendaId ? { tiendaId } : {}),
      ...(userIds ? { userId: { in: userIds } } : {}),
    },
    select: {
      userId: true,
      tiendaId: true,
      tipo: true,
      timestamp: true,
      user: { select: { nombre: true, apellidos: true } },
      tienda: { select: { nombre: true } },
    },
    orderBy: { timestamp: "asc" },
  });
  return fichajes as FichajeMin[];
}

/** Carga los fichajes del periodo (con scope) y devuelve la agregación. */
export async function calcularHorasPorCentro(opts: {
  prisma: PrismaClient;
  fechaInicio: Date;
  fechaFin: Date;
  /** Si se pasa, limita a una sede (para MANAGER). */
  tiendaId?: string | null;
}): Promise<FilaHorasCentroConContrato[]> {
  const { prisma, fechaInicio, fechaFin, tiendaId } = opts;
  const filas = agregarHorasPorCentro(
    await leerFichajes(prisma, fechaInicio, fechaFin, tiendaId ?? null),
  );
  // Con filtro de sede, el total contra el que se mide el contrato sigue
  // siendo el de TODAS las sedes de la persona (criterio de la columna
  // "Contrato" del cuadrante): si no, quien reparte su jornada entre varias
  // aparecería como deficitario en cada una.
  const filasGlobales =
    tiendaId && filas.length > 0
      ? agregarHorasPorCentro(
          await leerFichajes(prisma, fechaInicio, fechaFin, null, [
            ...new Set(filas.map((f) => f.userId)),
          ]),
        )
      : filas;
  return conContrato(prisma, filas, filasGlobales, fechaInicio, fechaFin);
}

/** Turno del cuadrante con lo mínimo para agregar horas y etiquetar la fila. */
export interface TurnoMin extends TurnoLite {
  userId: string;
  tiendaId: string | null;
  user: { nombre: string; apellidos: string };
  tienda: { nombre: string } | null;
}

/**
 * Agrega las horas PLANIFICADAS del cuadrante por (empleado, centro).
 *
 * Las horas de cada turno salen de `horasDeTurno` (tipo de turno > rango
 * horario, LIBRE = 0), la misma función que usan la pantalla de Turnos y el
 * export del cuadrante: así el informe cuadra con lo que el cliente ve ahí.
 * Se acumula en minutos enteros para no arrastrar error de coma flotante.
 */
export function agregarHorasCuadrantePorCentro(
  turnos: TurnoMin[],
): FilaHorasCentro[] {
  const acc = new Map<string, FilaHorasCentro>();
  for (const t of turnos) {
    const key = `${t.userId}::${t.tiendaId ?? "sin"}`;
    const minutos = Math.max(0, Math.round(horasDeTurno(t) * 60));
    const fila = acc.get(key);
    if (fila) {
      fila.minutos += minutos;
      continue;
    }
    acc.set(key, {
      userId: t.userId,
      empleado: `${t.user.nombre} ${t.user.apellidos}`.trim(),
      tiendaId: t.tiendaId,
      centro: t.tienda?.nombre ?? (t.tiendaId ? "—" : "Sin sede"),
      minutos,
      horas: 0,
    });
  }
  return [...acc.values()]
    .map((f) => ({ ...f, horas: Math.round((f.minutos / 60) * 100) / 100 }))
    .sort(
      (a, b) =>
        a.empleado.localeCompare(b.empleado, "es") ||
        a.centro.localeCompare(b.centro, "es"),
    );
}

/** Lee los turnos del periodo con el scope pedido. */
async function leerTurnos(
  prisma: PrismaClient,
  fechaInicio: Date,
  fechaFin: Date,
  tiendaId: string | null,
  userIds?: string[],
): Promise<TurnoMin[]> {
  const turnos = await prisma.turno.findMany({
    where: {
      fecha: { gte: fechaInicio, lte: fechaFin },
      ...(tiendaId ? { tiendaId } : {}),
      ...(userIds ? { userId: { in: userIds } } : {}),
      // Solo plantilla activa (ticket #65): un empleado dado de baja puede
      // conservar turnos planificados de sus últimos días, y el informe los
      // sumaba como horas de gente que ya no está. La exportación del
      // cuadrante ya filtraba así; esto alinea el informe con ella.
      // En la variante de FICHAJES no se filtra a propósito: esas horas se
      // trabajaron de verdad y quitarlas falsearía el histórico.
      user: { activo: true },
      // Los turnos confirmados como NO trabajados no suman horas previstas
      // (ticket c1e94a7b): estaban en el cuadrante, nadie fichó y se ha
      // confirmado al corregir la discrepancia. Siguen visibles en el cuadrante
      // —en amarillo— y salen aparte, en la hoja de incidencias del Excel.
      noRealizado: false,
    },
    select: {
      userId: true,
      tiendaId: true,
      horaInicio: true,
      horaFin: true,
      // `horas` llega como Decimal; `horasDeTurno` ya acepta Decimal/string.
      tipoTurno: {
        select: { abreviatura: true, nombre: true, horas: true, esLibre: true },
      },
      user: { select: { nombre: true, apellidos: true } },
      tienda: { select: { nombre: true } },
    },
    orderBy: { fecha: "asc" },
  });
  return turnos as TurnoMin[];
}

/** Carga los turnos del periodo (con scope) y devuelve la agregación. */
export async function calcularHorasPorCentroCuadrante(opts: {
  prisma: PrismaClient;
  fechaInicio: Date;
  fechaFin: Date;
  /** Si se pasa, limita a una sede (para MANAGER o filtro del OWNER). */
  tiendaId?: string | null;
}): Promise<FilaHorasCentroConContrato[]> {
  const { prisma, fechaInicio, fechaFin, tiendaId } = opts;
  const filas = agregarHorasCuadrantePorCentro(
    await leerTurnos(prisma, fechaInicio, fechaFin, tiendaId ?? null),
  );
  // Ver `calcularHorasPorCentro`: con filtro de sede, el contrato se mide
  // contra las horas del empleado en todas las suyas.
  const filasGlobales =
    tiendaId && filas.length > 0
      ? agregarHorasCuadrantePorCentro(
          await leerTurnos(prisma, fechaInicio, fechaFin, null, [
            ...new Set(filas.map((f) => f.userId)),
          ]),
        )
      : filas;
  return conContrato(prisma, filas, filasGlobales, fechaInicio, fechaFin);
}
