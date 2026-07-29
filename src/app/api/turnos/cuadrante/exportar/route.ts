/**
 * GET /api/turnos/cuadrante/exportar?fechaInicio=&fechaFin=&tiendaId=
 *
 * Exporta el cuadrante semanal a Excel (.xlsx): una fila por empleado
 * agrupada por sede, con la etiqueta del turno de cada día y las
 * columnas Total semana / Horas contrato / Diferencia. Reproduce el
 * Excel con el que trabaja el cliente.
 *
 * Reutiliza `horasDeTurno`/`etiquetaTurno` para contar igual que la UI.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { horasDeTurno, etiquetaTurno } from "@/lib/turnos/horas";
import ExcelJS from "exceljs";

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const GET = withTenant(
  withFeature("turnos_publicacion", async (request: NextRequest) => {
    const session = await auth();
    const user = session?.user as { rol?: Rol; tiendaId?: string | null } | undefined;
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (user.rol !== Rol.OWNER && user.rol !== Rol.MANAGER) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const fechaInicio = searchParams.get("fechaInicio");
    const fechaFin = searchParams.get("fechaFin");
    if (!fechaInicio || !fechaFin) {
      return NextResponse.json(
        { error: "Faltan fechaInicio/fechaFin" },
        { status: 400 },
      );
    }
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    fin.setHours(23, 59, 59, 999);
    const dias = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(inicio);
      d.setDate(d.getDate() + i);
      return d;
    });

    // MANAGER queda restringido a su sede; OWNER puede filtrar o ver todas.
    const reqTiendaId = searchParams.get("tiendaId");
    let tiendaFiltro: string | null = null;
    if (user.rol === Rol.MANAGER) tiendaFiltro = user.tiendaId ?? null;
    else if (reqTiendaId && reqTiendaId !== "todas") tiendaFiltro = reqTiendaId;

    // Alcance de los TURNOS que cargamos. Debe cubrir TODAS las sedes del
    // empleado (no solo la filtrada) para que la Diferencia vs. contrato se
    // mida sobre su jornada global — igual que la UI del cuadrante, que carga
    // todos los turnos y compara contra el total global de la persona. Si aquí
    // acotáramos por la sede filtrada, un correturno que reparte su semana
    // entre varias tiendas saldría como deficitario al exportar una sede
    // concreta (era el bug: la diferencia perdía sus horas en las otras sedes).
    // Solo la restricción OBLIGATORIA del MANAGER (su sede) acota este alcance;
    // el filtro OPCIONAL de sede del OWNER no. Las columnas por día y el Total
    // por sede siguen siendo por-sede vía `porUserTiendaDia`, y solo se imprimen
    // las sedes de `tiendas`/`empleados` (que sí respetan `tiendaFiltro`).
    const tiendaScopeTurnos =
      user.rol === Rol.MANAGER ? (user.tiendaId ?? null) : null;

    const [config, tiendas, empleados, turnos] = await Promise.all([
      prisma.configuracionEmpresa.findFirst({ select: { horasSemanales: true } }),
      prisma.tienda.findMany({
        where: { activa: true, ...(tiendaFiltro ? { id: tiendaFiltro } : {}) },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" },
      }),
      prisma.user.findMany({
        where: {
          activo: true,
          ...(tiendaFiltro ? { tiendaId: tiendaFiltro } : {}),
        },
        select: {
          id: true,
          nombre: true,
          apellidos: true,
          tiendaId: true,
          horasSemanalesContrato: true,
        },
        orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
      }),
      prisma.turno.findMany({
        where: {
          fecha: { gte: inicio, lte: fin },
          ...(tiendaScopeTurnos ? { tiendaId: tiendaScopeTurnos } : {}),
          // Solo plantilla activa (ticket #65): quien está de baja puede
          // conservar turnos planificados y, al no estar en `empleados`,
          // aparecía como fila "(correturno)" fantasma en el Excel. La
          // pantalla del cuadrante ya los descarta (solo pinta gente de
          // /api/empleados?activo=true).
          user: { activo: true },
        },
        select: {
          userId: true,
          tiendaId: true,
          fecha: true,
          horaInicio: true,
          horaFin: true,
          tipoTurno: { select: { abreviatura: true, nombre: true, horas: true, esLibre: true } },
          user: { select: { nombre: true, apellidos: true } },
        },
      }),
    ]);

    const horasGlobal = Number(config?.horasSemanales ?? 40);

    // Contrato semanal efectivo de cada persona (el suyo o el de la empresa).
    // Se indexa por userId porque las filas de correturno no salen de
    // `empleados` (son fijos de OTRA sede), sino de los turnos: sin este
    // índice no había de dónde sacar su contrato y las columnas "Horas
    // contrato"/"Diferencia" salían en blanco.
    const contratoEfectivo = (horasSemanalesContrato: unknown) =>
      horasSemanalesContrato != null ? Number(horasSemanalesContrato) : horasGlobal;
    const contratoPorUser = new Map<string, number>(
      empleados.map((e) => [e.id, contratoEfectivo(e.horasSemanalesContrato)]),
    );
    // Con filtro de sede del OWNER, `empleados` solo trae los fijos de esa
    // sede: hay que completar el índice con los correturnos que la cubren.
    if (tiendaFiltro && !tiendaScopeTurnos) {
      const visitantes = [
        ...new Set(turnos.map((t) => t.userId).filter((id) => !contratoPorUser.has(id))),
      ];
      if (visitantes.length > 0) {
        const extra = await prisma.user.findMany({
          where: { id: { in: visitantes }, activo: true },
          select: { id: true, horasSemanalesContrato: true },
        });
        for (const e of extra) {
          contratoPorUser.set(e.id, contratoEfectivo(e.horasSemanalesContrato));
        }
      }
    }

    // Dos índices: global (userId+ymd) — cubre TODAS las sedes de la persona,
    // sostiene "Sin sede" y la Diferencia vs. contrato — y por sede
    // (userId+tiendaId+ymd) para que cada correturno cuente solo en la
    // tienda que cubre — igual que la pantalla del cuadrante.
    const porUserDia = new Map<string, typeof turnos>();
    const porUserTiendaDia = new Map<string, typeof turnos>();
    for (const t of turnos) {
      const yd = ymd(new Date(t.fecha));
      const kGlobal = `${t.userId}|${yd}`;
      const kSede = `${t.userId}|${t.tiendaId}|${yd}`;
      (porUserDia.get(kGlobal) ?? porUserDia.set(kGlobal, []).get(kGlobal)!).push(t);
      (porUserTiendaDia.get(kSede) ?? porUserTiendaDia.set(kSede, []).get(kSede)!).push(t);
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Cuadrante");
    ws.columns = [
      { header: "Sede", key: "sede", width: 22 },
      { header: "Empleado", key: "empleado", width: 28 },
      ...dias.map((d, i) => ({
        header: `${DIAS[i]} ${d.getDate()}`,
        key: `d${i}`,
        width: 14,
      })),
      { header: "Total semana", key: "total", width: 13 },
      // El contrato es de la PERSONA, no de la sede, así que la Diferencia se
      // mide contra las horas del empleado en todas sus sedes. Sin esta
      // columna, en una fila de sede el "Total semana − Horas contrato" no
      // cuadraba con la Diferencia y no había forma de reconciliarlo en el
      // Excel (en pantalla lo explica la pista "+Nh otras sedes"). El MANAGER
      // solo ve los turnos de su sede, así que ahí la columna es el total del
      // empleado dentro de su alcance y se etiqueta como tal.
      {
        header: tiendaScopeTurnos ? "Total del empleado" : "Total todas las sedes",
        key: "totalGlobal",
        width: 19,
      },
      { header: "Horas contrato", key: "contrato", width: 14 },
      { header: "Diferencia", key: "dif", width: 12 },
    ];
    ws.getRow(1).font = { bold: true };

    const grupos: { id: string | null; nombre: string }[] = [
      ...tiendas.map((t) => ({ id: t.id as string | null, nombre: t.nombre })),
    ];
    if (!tiendaFiltro && empleados.some((e) => !e.tiendaId)) {
      grupos.push({ id: null, nombre: "Sin sede" });
    }

    // Construye y añade una fila. `tiendaScope` null = totales globales
    // (grupo "Sin sede"); con id = solo los turnos de esa tienda.
    // `contrato` null = no se conoce su contrato (o el alcance de turnos no
    // cubre todas sus sedes) → se dejan en blanco contrato y diferencia.
    const addEmpRow = (
      sede: string,
      empleado: string,
      userId: string,
      tiendaScope: string | null,
      contrato: number | null,
    ) => {
      const row: Record<string, string | number> = { sede, empleado };
      let total = 0;
      dias.forEach((d, i) => {
        const ts = tiendaScope
          ? porUserTiendaDia.get(`${userId}|${tiendaScope}|${ymd(d)}`) ?? []
          : porUserDia.get(`${userId}|${ymd(d)}`) ?? [];
        if (ts.length === 0) {
          row[`d${i}`] = "";
          return;
        }
        total += ts.reduce((s, t) => s + horasDeTurno(t), 0);
        row[`d${i}`] = ts.map((t) => etiquetaTurno(t)).join(" + ");
      });
      row.total = Math.round(total * 100) / 100;
      // La diferencia contra el contrato (semanal y global de la persona) se
      // mide sobre las horas del empleado en TODAS las sedes (índice global
      // `porUserDia`), no solo en esta: si no, a quien reparte su jornada entre
      // varias tiendas se le exigiría el contrato completo en cada una. El
      // índice global ya incluye todas las sedes aunque el OWNER exporte una
      // sede concreta (ver `tiendaScopeTurnos`), así que coincide con la UI.
      const totalGlobal = dias.reduce(
        (s, d) =>
          s +
          (porUserDia.get(`${userId}|${ymd(d)}`) ?? []).reduce(
            (a, t) => a + horasDeTurno(t),
            0,
          ),
        0,
      );
      row.totalGlobal = Math.round(totalGlobal * 100) / 100;
      row.contrato = contrato ?? "";
      row.dif =
        contrato === null ? "" : Math.round((totalGlobal - contrato) * 100) / 100;
      ws.addRow(row);
    };

    // Contrato a imprimir para una persona. Los correturnos SÍ lo llevan
    // (ticket #64: en pantalla ya se muestran total, contrato y diferencia),
    // pero solo si el índice global de turnos cubre todas sus sedes: con el
    // alcance restringido del MANAGER (solo la suya) la diferencia saldría
    // como déficit falso, así que ahí se deja en blanco.
    const contratoDe = (userId: string, esCorreturno = false): number | null => {
      if (esCorreturno && tiendaScopeTurnos !== null) return null;
      return contratoPorUser.get(userId) ?? null;
    };

    for (const grupo of grupos) {
      if (grupo.id === null) {
        // "Sin sede": empleados sin tienda, con su carga global.
        for (const emp of empleados.filter((e) => !e.tiendaId)) {
          addEmpRow(grupo.nombre, `${emp.nombre} ${emp.apellidos}`, emp.id, null, contratoDe(emp.id));
        }
        continue;
      }
      // Sede: fijos (scoping a la sede) + correturnos que la cubren.
      const fijos = empleados.filter((e) => e.tiendaId === grupo.id);
      const fijosIds = new Set(fijos.map((e) => e.id));
      for (const emp of fijos) {
        addEmpRow(grupo.nombre, `${emp.nombre} ${emp.apellidos}`, emp.id, grupo.id, contratoDe(emp.id));
      }
      const visitantes = new Map<string, string>();
      for (const t of turnos) {
        if (t.tiendaId === grupo.id && !fijosIds.has(t.userId)) {
          visitantes.set(t.userId, `${t.user?.nombre ?? ""} ${t.user?.apellidos ?? ""}`.trim());
        }
      }
      for (const [userId, nombre] of visitantes) {
        addEmpRow(grupo.nombre, `${nombre} (correturno)`, userId, grupo.id, contratoDe(userId, true));
      }
    }

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = `cuadrante-turnos-${ymd(inicio)}.xlsx`;
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.length),
      },
    });
  }),
);
