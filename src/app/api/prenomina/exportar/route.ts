/**
 * GET /api/prenomina/exportar?periodo=YYYY-MM&formato=csv|xlsx&gestor=generico|sage|a3
 *
 * Exporta el resumen de prenominas del periodo:
 * - `gestor=generico` (default): una fila por empleado con cifras agregadas.
 * - `gestor=sage`: layout Sage Despachos (una fila por concepto/movimiento).
 * - `gestor=a3`: layout A3NOM (una fila por concepto/movimiento).
 *
 * Las prenominas en BORRADOR se incluyen pero con flag de estado.
 * Feature: `prenomina`. Solo OWNER (ticket 73: el coordinador no ve los
 * salarios de su equipo).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import {
  buildExportTable,
  tableToCsv,
  type Gestor,
  type PrenominaParaExport,
} from "@/lib/prenomina/exporters";

const GESTORES: Gestor[] = ["generico", "sage", "a3"];

export const GET = withTenant(
  withFeature("prenomina", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo el Administrador" }, { status: 403 });
    }

    const periodo = req.nextUrl.searchParams.get("periodo");
    const formato = (req.nextUrl.searchParams.get("formato") ?? "csv").toLowerCase();
    const gestorParam = (req.nextUrl.searchParams.get("gestor") ?? "generico").toLowerCase();
    const gestor: Gestor = (GESTORES.includes(gestorParam as Gestor)
      ? gestorParam
      : "generico") as Gestor;
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
      return NextResponse.json({ error: "periodo requerido (YYYY-MM)" }, { status: 400 });
    }
    if (formato !== "csv" && formato !== "xlsx") {
      return NextResponse.json({ error: "formato debe ser csv o xlsx" }, { status: 400 });
    }

    const prenominas = await prisma.prenomina.findMany({
      where: { periodo },
      include: {
        empleado: {
          select: { id: true, nombre: true, apellidos: true, email: true, dni: true },
        },
        conceptos: true,
      },
      orderBy: { empleado: { apellidos: "asc" } },
    });

    if (prenominas.length === 0) {
      return NextResponse.json(
        { error: "No hay prenominas para el periodo. Calcula primero." },
        { status: 404 },
      );
    }

    const datos: PrenominaParaExport[] = prenominas.map((p) => ({
      empleado: p.empleado,
      periodo: p.periodo,
      estado: p.estado,
      diasTrabajados: p.diasTrabajados,
      horasTrabajadas: Number(p.horasTrabajadas),
      horasOrdinarias: Number(p.horasOrdinarias),
      horasExtras: Number(p.horasExtras),
      horasNocturnas: Number(p.horasNocturnas),
      horasFestivas: Number(p.horasFestivas),
      diasAusenciaPagada: p.diasAusenciaPagada,
      diasAusenciaNoPagada: p.diasAusenciaNoPagada,
      salarioBase: Number(p.salarioBase),
      importeHorasExtras: Number(p.importeHorasExtras),
      importeNocturnidad: Number(p.importeNocturnidad),
      importeFestivos: Number(p.importeFestivos),
      importeConceptos: Number(p.importeConceptos),
      totalBruto: Number(p.totalBruto),
      moneda: p.moneda,
      conceptos: p.conceptos.map((c) => ({
        tipo: c.tipo,
        descripcion: c.descripcion,
        cantidad: c.cantidad != null ? Number(c.cantidad) : null,
        importe: Number(c.importe),
      })),
    }));

    const table = buildExportTable(datos, periodo, gestor);
    const filename = `${table.filename}.${formato}`;

    if (formato === "csv") {
      // Sage/A3 esperan ; como separador en España.
      const sep = gestor === "generico" ? "," : ";";
      const csv = tableToCsv(table, sep);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Prenómina");
    ws.addRow(table.headers);
    for (const row of table.rows) ws.addRow(row);
    ws.getRow(1).font = { bold: true };
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }),
);
