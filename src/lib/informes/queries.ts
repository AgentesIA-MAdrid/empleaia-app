/**
 * Queries de informes — función pura compartida por:
 *  - GET /api/informes (devuelve JSON al cliente).
 *  - GET /api/informes/exportar (genera CSV/Excel/PDF a partir del payload).
 *
 * Plan Fase 5 cierre FIX 3. Antes había fetch interno entre rutas
 * Next del mismo proceso (ECONNREFUSED en runtime real porque Node
 * no resuelve subdominios `*.localhost` como el navegador). El
 * patrón correcto: extraer la lógica a una función pura y dejar
 * que ambos handlers la invoquen sin red.
 *
 * Convención: NO se hace fetch interno entre rutas Next del mismo
 * proceso. Si hay lógica compartida, vive en `src/lib/`. Ver
 * docs/arch/00-todos-consolidados.md N5.
 */

import { Rol, TipoFichaje } from "@/generated/prisma-tenant/client";
import type { PrismaClient } from "@/generated/prisma-tenant/client";
import {
  diasDelPeriodo,
  diferenciaContrato,
  horasContratoPeriodo,
  horasSemanalesDe,
  type HorasContratoRaw,
} from "@/lib/informes/horas-contrato";

export type InformeTipo =
  | "fichajes"
  | "ausencias"
  | "turnos"
  | "resumen"
  | "presencia"
  | "presencia-global";

export type InformeQueryArgs = {
  tipo: InformeTipo;
  /** ISO 8601 string. Requerido salvo en presencia/presencia-global. */
  fechaInicio?: string | null;
  /** ISO 8601 string. Requerido salvo en presencia/presencia-global. */
  fechaFin?: string | null;
  tiendaId?: string | null;
  userId?: string | null;
  /** YYYY-MM-DD para presencia (default: hoy). */
  fecha?: string | null;
  /** Identidad del usuario que solicita (para filtrado por rol). */
  userRol: Rol;
  userTiendaId: string | null;
  sessionUserId: string;
  /** prismaApp del tenant activo. Inyectado para testabilidad. */
  prisma: PrismaClient;
};

export type InformeError = { error: string; status: number };

export type InformePayload = Record<string, unknown> & { tipo?: string };

/**
 * Devuelve `{ ok: true, data }` con el JSON shape esperado por el
 * cliente, o `{ ok: false, error, status }` con un error de validación
 * o autorización (que el handler convertirá a Response).
 */
export type InformeResult =
  | { ok: true; data: InformePayload }
  | { ok: false; error: string; status: number };

export async function getInformeData(
  args: InformeQueryArgs,
): Promise<InformeResult> {
  const { tipo, prisma, userRol, userTiendaId, sessionUserId } = args;

  const tiposValidos: InformeTipo[] = [
    "fichajes",
    "ausencias",
    "turnos",
    "resumen",
    "presencia",
    "presencia-global",
  ];
  if (!tiposValidos.includes(tipo)) {
    return { ok: false, error: "Parámetro 'tipo' inválido", status: 400 };
  }

  const necesitaFechas = !["presencia", "presencia-global"].includes(tipo);
  if (necesitaFechas && (!args.fechaInicio || !args.fechaFin)) {
    return {
      ok: false,
      error: "Los parámetros fechaInicio y fechaFin son obligatorios",
      status: 400,
    };
  }

  const inicio = args.fechaInicio ? new Date(args.fechaInicio) : null;
  if (inicio) inicio.setHours(0, 0, 0, 0);
  const fin = args.fechaFin ? new Date(args.fechaFin) : null;
  if (fin) fin.setHours(23, 59, 59, 999);

  // Filtro base por rol — replicado de la versión inline anterior.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roleFilter: any = {};
  if (userRol === Rol.OWNER) {
    if (args.tiendaId) roleFilter.tiendaId = args.tiendaId;
    if (args.userId) roleFilter.userId = args.userId;
  } else if (userRol === Rol.MANAGER) {
    roleFilter.tiendaId = userTiendaId;
    if (args.userId) roleFilter.userId = args.userId;
  } else {
    roleFilter.userId = sessionUserId;
  }

  if (tipo === "fichajes") {
    return { ok: true, data: await informeFichajes(prisma, roleFilter, inicio!, fin!) };
  }
  if (tipo === "ausencias") {
    return { ok: true, data: await informeAusencias(prisma, roleFilter, inicio!, fin!, userRol) };
  }
  if (tipo === "turnos") {
    return { ok: true, data: await informeTurnos(prisma, roleFilter, inicio!, fin!) };
  }
  if (tipo === "resumen") {
    return {
      ok: true,
      data: await informeResumen(
        prisma,
        roleFilter,
        inicio!,
        fin!,
        userRol,
        userTiendaId,
        args.tiendaId ?? null,
        args.userId ?? null,
      ),
    };
  }
  if (tipo === "presencia") {
    const fecha = args.fecha || new Date().toISOString().split("T")[0]!;
    return {
      ok: true,
      data: await informePresencia(prisma, roleFilter, userRol, userTiendaId, fecha),
    };
  }
  if (tipo === "presencia-global") {
    if (userRol !== Rol.OWNER) {
      return { ok: false, error: "No autorizado", status: 403 };
    }
    return { ok: true, data: await informePresenciaGlobal(prisma) };
  }
  return { ok: false, error: "Tipo de informe no implementado", status: 400 };
}

// ─── Implementaciones por tipo ───────────────────────────────────────────────

async function informeFichajes(
  prisma: PrismaClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roleFilter: any,
  inicio: Date,
  fin: Date,
): Promise<InformePayload> {
  const fichajes = await prisma.fichaje.findMany({
    where: { ...roleFilter, timestamp: { gte: inicio, lte: fin } },
    select: {
      id: true,
      timestamp: true,
      tipo: true,
      latitud: true,
      longitud: true,
      distancia: true,
      metodo: true,
      nota: true,
      tiendaId: true,
      // No exponemos `fotoSnapshotEnc` (binario cifrado, no necesario en
      // respuesta JSON). El cliente sabe que hay foto si `tieneFoto=true`.
      user: { select: { id: true, nombre: true, apellidos: true, email: true, foto: true } },
      // `radio` permite contrastar `distancia` contra el perímetro de
      // la sede y marcar los fichajes hechos fuera de ella.
      tienda: { select: { id: true, nombre: true, radio: true } },
      fotoSnapshotEnc: false,
    },
    orderBy: [{ userId: "asc" }, { timestamp: "asc" }],
  });
  // Indica si hay foto sin enviar el blob completo. Bandera ligera.
  const data = fichajes.map((f) => ({ ...f }));
  // Lee solo la presencia (length > 0) en una segunda query agregada.
  const conFoto = await prisma.fichaje.findMany({
    where: {
      ...roleFilter,
      timestamp: { gte: inicio, lte: fin },
      fotoSnapshotEnc: { not: null },
    },
    select: { id: true },
  });
  const fotoSet = new Set(conFoto.map((f) => f.id));
  const enriched = data.map((f) => ({ ...f, tieneFoto: fotoSet.has(f.id) }));
  return { tipo: "fichajes", data: enriched, total: enriched.length };
}

async function informeAusencias(
  prisma: PrismaClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roleFilter: any,
  inicio: Date,
  fin: Date,
  userRol: Rol,
): Promise<InformePayload> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    fechaInicio: { lte: fin },
    fechaFin: { gte: inicio },
  };
  if (userRol === Rol.OWNER) {
    if (roleFilter.tiendaId) where.user = { tiendaId: roleFilter.tiendaId };
    if (roleFilter.userId) where.userId = roleFilter.userId;
  } else if (userRol === Rol.MANAGER) {
    where.user = { tiendaId: roleFilter.tiendaId };
    if (roleFilter.userId) where.userId = roleFilter.userId;
  } else {
    where.userId = roleFilter.userId;
  }
  const ausencias = await prisma.ausencia.findMany({
    where,
    include: {
      user: { select: { id: true, nombre: true, apellidos: true, email: true } },
      tipoAusencia: true,
      aprobadoPor: { select: { id: true, nombre: true, apellidos: true } },
    },
    orderBy: [{ userId: "asc" }, { fechaInicio: "asc" }],
  });
  return { tipo: "ausencias", data: ausencias, total: ausencias.length };
}

async function informeTurnos(
  prisma: PrismaClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roleFilter: any,
  inicio: Date,
  fin: Date,
): Promise<InformePayload> {
  const turnos = await prisma.turno.findMany({
    where: { ...roleFilter, fecha: { gte: inicio, lte: fin } },
    include: {
      user: { select: { id: true, nombre: true, apellidos: true, email: true } },
      tienda: { select: { id: true, nombre: true } },
    },
    orderBy: [{ userId: "asc" }, { fecha: "asc" }],
  });
  return { tipo: "turnos", data: turnos, total: turnos.length };
}

async function informeResumen(
  prisma: PrismaClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roleFilter: any,
  inicio: Date,
  fin: Date,
  userRol: Rol,
  userTiendaId: string | null,
  tiendaId: string | null,
  userId: string | null,
): Promise<InformePayload> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userWhere: any = { activo: true };
  if (userRol === Rol.OWNER) {
    if (tiendaId) userWhere.tiendaId = tiendaId;
    if (userId) userWhere.id = userId;
  } else if (userRol === Rol.MANAGER) {
    userWhere.tiendaId = userTiendaId;
    if (userId) userWhere.id = userId;
  } else {
    userWhere.id = roleFilter.userId;
  }

  const empleados = await prisma.user.findMany({
    where: userWhere,
    select: {
      id: true,
      nombre: true,
      apellidos: true,
      email: true,
      // Horas de contrato de la persona: base de la diferencia y, por tanto,
      // de las horas extra. Si es null se usa la jornada de la empresa.
      horasSemanalesContrato: true,
      tienda: { select: { id: true, nombre: true } },
    },
  });
  const empleadoIds = empleados.map((e) => e.id);

  const diasPeriodo = diasDelPeriodo(inicio, fin);

  const [config, fichajes, ausencias] = await Promise.all([
    // Jornada semanal por defecto: se aplica a quien no tiene contrato propio.
    prisma.configuracionEmpresa.findFirst({ select: { horasSemanales: true } }),
    prisma.fichaje.findMany({
      where: { userId: { in: empleadoIds }, timestamp: { gte: inicio, lte: fin } },
      orderBy: [{ userId: "asc" }, { timestamp: "asc" }],
    }),
    prisma.ausencia.findMany({
      where: {
        userId: { in: empleadoIds },
        estado: "APROBADA",
        fechaInicio: { lte: fin },
        fechaFin: { gte: inicio },
      },
      include: { tipoAusencia: { select: { nombre: true, pagada: true } } },
    }),
  ]);

  const fichajesByUser = new Map<string, typeof fichajes>();
  for (const f of fichajes) {
    const existing = fichajesByUser.get(f.userId) ?? [];
    existing.push(f);
    fichajesByUser.set(f.userId, existing);
  }
  const ausenciasByUser = new Map<string, typeof ausencias>();
  for (const a of ausencias) {
    const existing = ausenciasByUser.get(a.userId) ?? [];
    existing.push(a);
    ausenciasByUser.set(a.userId, existing);
  }

  const resumen = empleados.map((empleado) => {
    const userFichajes = fichajesByUser.get(empleado.id) ?? [];
    const userAusencias = ausenciasByUser.get(empleado.id) ?? [];

    let totalMinutos = 0;
    let periodoInicio: Date | null = null;
    for (const f of userFichajes) {
      if (f.tipo === TipoFichaje.ENTRADA || f.tipo === TipoFichaje.VUELTA_PAUSA) {
        periodoInicio = f.timestamp;
      } else if (
        (f.tipo === TipoFichaje.PAUSA || f.tipo === TipoFichaje.SALIDA) &&
        periodoInicio !== null
      ) {
        totalMinutos += Math.floor(
          (f.timestamp.getTime() - periodoInicio.getTime()) / 60000,
        );
        periodoInicio = null;
      }
    }
    const totalHoras = Math.round((totalMinutos / 60) * 100) / 100;
    const totalDiasAusencia = userAusencias.reduce((acc, a) => acc + a.dias, 0);
    const diasPorTipo = userAusencias.reduce(
      (acc, a) => {
        const k = a.tipoAusencia.nombre;
        acc[k] = (acc[k] ?? 0) + a.dias;
        return acc;
      },
      {} as Record<string, number>,
    );
    const totalFichajes = userFichajes.length;
    const diasTrabajados = new Set(
      userFichajes
        .filter((f) => f.tipo === TipoFichaje.ENTRADA)
        .map((f) => f.timestamp.toISOString().split("T")[0]),
    ).size;
    // Horas de contrato del periodo y diferencia contra lo trabajado: es lo
    // que convierte el informe en algo con lo que calcular horas extra. Antes
    // se asumía una jornada fija de 8h/día trabajado, que ignoraba tanto el
    // contrato de la persona como la jornada configurada de la empresa.
    const horasContrato = horasContratoPeriodo(
      horasSemanalesDe(
        empleado.horasSemanalesContrato as HorasContratoRaw,
        config?.horasSemanales ?? null,
      ),
      diasPeriodo,
    );
    const diferencia = diferenciaContrato(totalHoras, horasContrato);
    return {
      empleado,
      totalHoras,
      totalMinutos,
      diasTrabajados,
      totalFichajes,
      totalDiasAusencia,
      diasPorTipo,
      horasContrato,
      diferencia,
    };
  });

  const totalHorasGlobal = resumen.reduce((acc, e) => acc + e.totalHoras, 0);
  const diasTotales = resumen.reduce((acc, e) => acc + e.diasTrabajados, 0);
  const totalHorasContrato = resumen.reduce((acc, e) => acc + e.horasContrato, 0);
  const stats = {
    totalHoras: Math.round(totalHorasGlobal * 10) / 10,
    mediaHorasDia:
      diasTotales > 0
        ? Math.round((totalHorasGlobal / diasTotales) * 10) / 10
        : 0,
    // Horas de contrato del periodo (suma de las de cada empleado) y horas
    // extra = suma de los excesos individuales. No se compensan entre
    // personas: quien va por debajo no descuenta las extras de otro.
    horasContrato: Math.round(totalHorasContrato * 10) / 10,
    diferencia: Math.round((totalHorasGlobal - totalHorasContrato) * 10) / 10,
    horasExtra:
      Math.round(
        resumen.reduce((acc, e) => acc + Math.max(0, e.diferencia), 0) * 10,
      ) / 10,
    totalAusencias: resumen.reduce((acc, e) => acc + e.totalDiasAusencia, 0),
  };
  const empleadosResumen = resumen.map((e) => ({
    userId: e.empleado.id,
    nombre: e.empleado.nombre,
    apellidos: e.empleado.apellidos,
    diasTrabajados: e.diasTrabajados,
    horasTotales: e.totalHoras,
    horasContrato: e.horasContrato,
    diferencia: e.diferencia,
    horasExtra: Math.max(0, e.diferencia),
    diasAusencia: e.totalDiasAusencia,
  }));
  return {
    tipo: "resumen",
    empleados: empleadosResumen,
    stats,
    total: empleados.length,
  };
}

async function informePresencia(
  prisma: PrismaClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roleFilter: any,
  userRol: Rol,
  userTiendaId: string | null,
  fecha: string,
): Promise<InformePayload> {
  const diaInicio = new Date(fecha + "T00:00:00");
  const diaFin = new Date(fecha + "T23:59:59");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereEmpleados: any = { activo: true, rol: { not: "OWNER" } };
  if (userRol === Rol.MANAGER) whereEmpleados.tiendaId = userTiendaId;
  if (roleFilter.tiendaId) whereEmpleados.tiendaId = roleFilter.tiendaId;

  const empleados = await prisma.user.findMany({
    where: whereEmpleados,
    select: { id: true, nombre: true, apellidos: true, tiendaId: true },
  });
  const fichajes = await prisma.fichaje.findMany({
    where: {
      userId: { in: empleados.map((e) => e.id) },
      timestamp: { gte: diaInicio, lte: diaFin },
    },
    orderBy: { timestamp: "asc" },
  });
  const fichajesPorUser = new Map<string, typeof fichajes>();
  for (const f of fichajes) {
    const arr = fichajesPorUser.get(f.userId) || [];
    arr.push(f);
    fichajesPorUser.set(f.userId, arr);
  }
  const resultado = empleados.map((emp) => {
    const uFichajes = fichajesPorUser.get(emp.id) || [];
    const ultimo = uFichajes[uFichajes.length - 1];
    let estado: "trabajando" | "en_pausa" | "sin_fichar" = "sin_fichar";
    let horaEntrada: string | undefined;
    let totalMin = 0;
    let periodoIn: Date | null = null;
    for (const f of uFichajes) {
      if (f.tipo === "ENTRADA" || f.tipo === "VUELTA_PAUSA") {
        if (f.tipo === "ENTRADA") horaEntrada = f.timestamp.toISOString();
        periodoIn = f.timestamp;
      } else if ((f.tipo === "PAUSA" || f.tipo === "SALIDA") && periodoIn) {
        totalMin += Math.floor(
          (f.timestamp.getTime() - periodoIn.getTime()) / 60000,
        );
        periodoIn = null;
      }
    }
    if (periodoIn) {
      totalMin += Math.floor(
        (new Date().getTime() - periodoIn.getTime()) / 60000,
      );
    }
    if (ultimo) {
      if (ultimo.tipo === "ENTRADA" || ultimo.tipo === "VUELTA_PAUSA") estado = "trabajando";
      else if (ultimo.tipo === "PAUSA") estado = "en_pausa";
      else estado = "sin_fichar";
    }
    return {
      id: emp.id,
      nombre: emp.nombre,
      apellidos: emp.apellidos,
      estado,
      horaEntrada,
      horasHoy: Math.round((totalMin / 60) * 10) / 10,
      fichajes: uFichajes.map((f) => ({ tipo: f.tipo, timestamp: f.timestamp })),
    };
  });
  return { empleados: resultado };
}

async function informePresenciaGlobal(
  prisma: PrismaClient,
): Promise<InformePayload> {
  const hoyInicio = new Date();
  hoyInicio.setHours(0, 0, 0, 0);
  const hoyFin = new Date();
  hoyFin.setHours(23, 59, 59, 999);
  const [tiendas, fichajosHoy, ausenciasHoy] = await Promise.all([
    prisma.tienda.findMany({
      where: { activa: true },
      include: {
        _count: {
          select: {
            empleados: { where: { activo: true, rol: { not: "OWNER" } } },
          },
        },
      },
    }),
    prisma.fichaje.findMany({
      where: { timestamp: { gte: hoyInicio, lte: hoyFin } },
      select: { userId: true, tipo: true, timestamp: true, tiendaId: true },
      orderBy: { timestamp: "asc" },
    }),
    prisma.ausencia.findMany({
      where: {
        estado: "APROBADA",
        fechaInicio: { lte: hoyFin },
        fechaFin: { gte: hoyInicio },
      },
      select: { userId: true },
    }),
  ]);
  const estadoPorUser = new Map<string, string>();
  const fichajesOrdenados = [...fichajosHoy].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  const ultimoPorUser = new Map<string, string>();
  for (const f of fichajesOrdenados) {
    ultimoPorUser.set(f.userId, f.tipo);
  }
  for (const [userId, tipo] of ultimoPorUser) {
    if (tipo === "ENTRADA" || tipo === "VUELTA_PAUSA") estadoPorUser.set(userId, "trabajando");
    else if (tipo === "PAUSA") estadoPorUser.set(userId, "en_pausa");
    else estadoPorUser.set(userId, "sin_fichar");
  }
  const ausentesIds = new Set(ausenciasHoy.map((a) => a.userId));
  const tiendasStats = tiendas.map((t) => {
    const fichajesTienda = fichajosHoy.filter((f) => f.tiendaId === t.id);
    const usersTienda = new Set(fichajesTienda.map((f) => f.userId));
    let trabajando = 0,
      enPausa = 0;
    for (const userId of usersTienda) {
      const e = estadoPorUser.get(userId);
      if (e === "trabajando") trabajando++;
      else if (e === "en_pausa") enPausa++;
    }
    const sinFichar = Math.max(0, t._count.empleados - trabajando - enPausa);
    const presenciaPct =
      t._count.empleados > 0
        ? Math.round(((trabajando + enPausa) / t._count.empleados) * 100)
        : 0;
    return {
      id: t.id,
      nombre: t.nombre,
      color: t.color,
      totalEmpleados: t._count.empleados,
      trabajando,
      enPausa,
      sinFichar,
      ausentes: [...ausentesIds].filter(
        (id) => fichajesTienda.some((f) => f.userId === id) || true,
      ).length,
      presenciaPct,
    };
  });
  const totalEmpleados = tiendasStats.reduce((a, t) => a + t.totalEmpleados, 0);
  const fichadosAhora = tiendasStats.reduce(
    (a, t) => a + t.trabajando + t.enPausa,
    0,
  );
  return {
    tiendas: tiendasStats,
    stats: {
      totalTiendas: tiendas.length,
      totalEmpleados,
      fichadosAhora,
      ausentesHoy: ausentesIds.size,
    },
  };
}
