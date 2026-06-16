/**
 * /admin/empleados/[id] — ficha 360º del empleado.
 *
 * Server component que agrega en paralelo: datos personales (con
 * tienda + manager + empresa), histórico de fichajes último mes,
 * ausencias últimos 12 meses, próximos turnos. La UI vive en el
 * componente cliente `FichaEmpleadoTabs`.
 *
 * Acceso: OWNER o MANAGER. EMPLEADO → 401 visible.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";
import { FICHA_SELECT, toEmpleadoDatos } from "@/lib/empleados/ficha";
import { FichaEmpleadoTabs } from "@/components/admin/ficha-empleado-tabs";

export const dynamic = "force-dynamic";

async function FichaEmpleadoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const rol = (session.user as { rol?: string }).rol;
  if (rol !== "OWNER" && rol !== "MANAGER") {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Acceso restringido</h1>
        <p className="text-sm text-slate-500 mt-2">
          Solo administradores y managers pueden consultar la ficha del empleado.
        </p>
      </div>
    );
  }

  const { id } = await params;

  const desde30 = new Date();
  desde30.setDate(desde30.getDate() - 30);
  const desde365 = new Date();
  desde365.setDate(desde365.getDate() - 365);
  const ahora = new Date();
  const proximoMes = new Date();
  proximoMes.setDate(proximoMes.getDate() + 30);

  const [empleado, fichajes, ausencias, turnos, totalFichajes] = await Promise.all([
    prismaApp.user.findUnique({
      where: { id },
      select: {
        ...FICHA_SELECT,
        foto: true,
        rol: true,
        activo: true,
        createdAt: true,
        salarioBase: true,
        tienda: { select: { id: true, nombre: true, color: true, ciudad: true } },
        manager: { select: { id: true, nombre: true, apellidos: true } },
        empresa: { select: { id: true, nombre: true } },
      },
    }),
    prismaApp.fichaje.findMany({
      where: { userId: id, timestamp: { gte: desde30 } },
      select: {
        id: true,
        timestamp: true,
        tipo: true,
        metodo: true,
        nota: true,
        tienda: { select: { nombre: true, color: true } },
      },
      orderBy: { timestamp: "desc" },
      take: 200,
    }),
    prismaApp.ausencia.findMany({
      where: { userId: id, fechaInicio: { gte: desde365 } },
      select: {
        id: true,
        fechaInicio: true,
        fechaFin: true,
        dias: true,
        motivo: true,
        estado: true,
        tipoAusencia: { select: { nombre: true, color: true, pagada: true } },
      },
      orderBy: { fechaInicio: "desc" },
    }),
    prismaApp.turno.findMany({
      where: { userId: id, fecha: { gte: ahora, lte: proximoMes } },
      select: {
        id: true,
        fecha: true,
        horaInicio: true,
        horaFin: true,
        estado: true,
        tienda: { select: { nombre: true, color: true } },
      },
      orderBy: { fecha: "asc" },
    }),
    prismaApp.fichaje.count({ where: { userId: id } }),
  ]);

  if (!empleado) notFound();

  const fichaDatos = toEmpleadoDatos(empleado);

  const ausenciasAprobadas = ausencias.filter((a) => a.estado === "APROBADA");
  const diasAusenciaUlt12m = ausenciasAprobadas.reduce((acc, a) => acc + a.dias, 0);
  const diasAusenciaPendientes = ausencias
    .filter((a) => a.estado === "PENDIENTE")
    .reduce((acc, a) => acc + a.dias, 0);

  // Calcular horas trabajadas últimas 30 días emparejando ENTRADA→SALIDA
  // del mismo día. Aproximación rápida: por día, sumar (max SALIDA - min
  // ENTRADA) descontando pausas. Suficiente para una métrica de cabecera.
  const fichajesAsc = [...fichajes].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  let horas30d = 0;
  const porDia = new Map<string, typeof fichajesAsc>();
  for (const f of fichajesAsc) {
    const k = f.timestamp.toISOString().slice(0, 10);
    const list = porDia.get(k) ?? [];
    list.push(f);
    porDia.set(k, list);
  }
  for (const dia of porDia.values()) {
    const entrada = dia.find((f) => f.tipo === "ENTRADA");
    const salida = [...dia].reverse().find((f) => f.tipo === "SALIDA");
    if (!entrada || !salida) continue;
    let ms = salida.timestamp.getTime() - entrada.timestamp.getTime();
    // Restar pausas (PAUSA → VUELTA_PAUSA siguiente).
    for (let i = 0; i < dia.length; i++) {
      if (dia[i].tipo !== "PAUSA") continue;
      const vuelta = dia.slice(i + 1).find((f) => f.tipo === "VUELTA_PAUSA");
      if (vuelta) ms -= vuelta.timestamp.getTime() - dia[i].timestamp.getTime();
    }
    if (ms > 0) horas30d += ms / 3_600_000;
  }
  const diasTrabajados30d = [...porDia.values()].filter((dia) =>
    dia.some((f) => f.tipo === "ENTRADA"),
  ).length;

  // Sedes donde ha fichado en los últimos 30 días.
  const sedesFichaje = Array.from(
    new Map(
      fichajes
        .filter((f) => f.tienda)
        .map((f) => [f.tienda!.nombre, f.tienda!]),
    ).values(),
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <Link
        href="/admin/empleados"
        className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900"
      >
        <ChevronLeft className="h-4 w-4 mr-1" /> Volver a empleados
      </Link>

      <FichaEmpleadoTabs
        empleado={{
          ...empleado,
          fechaNacimiento: empleado.fechaNacimiento?.toISOString() ?? null,
          createdAt: empleado.createdAt.toISOString(),
          salarioBase: empleado.salarioBase != null ? Number(empleado.salarioBase) : null,
        }}
        fichaDatos={fichaDatos}
        viewerRol={rol}
        metricas={{
          horas30d,
          diasTrabajados30d,
          diasAusenciaUlt12m,
          diasAusenciaPendientes,
          totalFichajes,
          sedesFichaje: sedesFichaje.map((s) => ({
            nombre: s.nombre,
            color: s.color,
          })),
        }}
        fichajes={fichajes.map((f) => ({
          ...f,
          timestamp: f.timestamp.toISOString(),
        }))}
        ausencias={ausencias.map((a) => ({
          ...a,
          fechaInicio: a.fechaInicio.toISOString(),
          fechaFin: a.fechaFin.toISOString(),
        }))}
        turnos={turnos.map((t) => ({
          ...t,
          fecha: t.fecha.toISOString(),
        }))}
      />
    </div>
  );
}

export default withTenantPage(FichaEmpleadoPage);
