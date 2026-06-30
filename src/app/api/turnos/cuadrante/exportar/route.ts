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
          ...(tiendaFiltro ? { tiendaId: tiendaFiltro } : {}),
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

    // Dos índices: global (userId+ymd) para "Sin sede" y por sede
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
    // `contrato` null = correturno (no se imprime contrato/diferencia).
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
      row.contrato = contrato ?? "";
      row.dif = contrato === null ? "" : Math.round((total - contrato) * 100) / 100;
      ws.addRow(row);
    };

    const contratoDe = (e: { horasSemanalesContrato: unknown }) =>
      e.horasSemanalesContrato != null ? Number(e.horasSemanalesContrato) : horasGlobal;

    for (const grupo of grupos) {
      if (grupo.id === null) {
        // "Sin sede": empleados sin tienda, con su carga global.
        for (const emp of empleados.filter((e) => !e.tiendaId)) {
          addEmpRow(grupo.nombre, `${emp.nombre} ${emp.apellidos}`, emp.id, null, contratoDe(emp));
        }
        continue;
      }
      // Sede: fijos (scoping a la sede) + correturnos que la cubren.
      const fijos = empleados.filter((e) => e.tiendaId === grupo.id);
      const fijosIds = new Set(fijos.map((e) => e.id));
      for (const emp of fijos) {
        addEmpRow(grupo.nombre, `${emp.nombre} ${emp.apellidos}`, emp.id, grupo.id, contratoDe(emp));
      }
      const visitantes = new Map<string, string>();
      for (const t of turnos) {
        if (t.tiendaId === grupo.id && !fijosIds.has(t.userId)) {
          visitantes.set(t.userId, `${t.user?.nombre ?? ""} ${t.user?.apellidos ?? ""}`.trim());
        }
      }
      for (const [userId, nombre] of visitantes) {
        addEmpRow(grupo.nombre, `${nombre} (correturno)`, userId, grupo.id, null);
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
