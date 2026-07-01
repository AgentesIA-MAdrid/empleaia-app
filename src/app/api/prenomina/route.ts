/**
 * GET /api/prenomina?periodo=YYYY-MM
 *   Lista las prenominas persistidas del periodo. Si todavía no se
 *   han calculado, devuelve `empleados: []` con `calculadaAt: null`.
 *
 * POST /api/prenomina/calcular?periodo=YYYY-MM
 *   Recalcula y persiste todas las prenominas BORRADOR del periodo.
 *   Las que estén CERRADAS o ENVIADAS se respetan (no se sobrescriben).
 *
 * Feature: `prenomina` (Pro+Enterprise). OWNER/MANAGER.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol, TipoFichaje } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import {
  calcularPrenomina,
  aplicarImportes,
  type ReglasNomina,
} from "@/lib/prenomina/calculo";
import { resolveEmpresaScope, userScopeFilter } from "@/lib/multi-empresa/scope";

function assertOwnerOrManager(rol: Rol | undefined) {
  if (rol !== Rol.OWNER && rol !== Rol.MANAGER) {
    return NextResponse.json({ error: "Solo OWNER/MANAGER" }, { status: 403 });
  }
  return null;
}

function parsePeriodo(periodo: string | null) {
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return null;
  const [yy, mm] = periodo.split("-").map(Number);
  const inicio = new Date(Date.UTC(yy, mm - 1, 1, 0, 0, 0));
  const fin = new Date(Date.UTC(yy, mm, 0, 23, 59, 59));
  return { yy, mm, inicio, fin };
}

export const GET = withTenant(
  withFeature("prenomina", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    const guard = assertOwnerOrManager(userRol);
    if (guard) return guard;

    const periodo = req.nextUrl.searchParams.get("periodo");
    const p = parsePeriodo(periodo);
    if (!p) {
      return NextResponse.json(
        { error: "Parámetro periodo requerido (YYYY-MM)" },
        { status: 400 },
      );
    }

    const cfg = await prisma.configuracionEmpresa.findUnique({
      where: { id: "singleton" },
      select: {
        horasJornadaDiaria: true,
        nominaJornadaSemanal: true,
        nominaMoneda: true,
      },
    });
    // Días laborables aproximados del mes (L-V).
    let diasLab = 0;
    for (let d = new Date(p.inicio); d <= p.fin; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.getUTCDay();
      if (day !== 0 && day !== 6) diasLab++;
    }
    const horasTeoricas = diasLab * (cfg?.horasJornadaDiaria ?? 8);

    const scope = await resolveEmpresaScope(session);
    const prenominas = await prisma.prenomina.findMany({
      where: {
        periodo: periodo!,
        ...(scope.empresaId ? { empleado: { empresaId: scope.empresaId } } : {}),
      },
      include: {
        empleado: { select: { id: true, nombre: true, apellidos: true, email: true, dni: true } },
        conceptos: true,
        cerradaPor: { select: { nombre: true, apellidos: true } },
      },
      orderBy: { empleado: { apellidos: "asc" } },
    });

    return NextResponse.json({
      periodo,
      horasTeoricas,
      diasLaborables: diasLab,
      moneda: cfg?.nominaMoneda ?? "EUR",
      jornadaSemanal: cfg?.nominaJornadaSemanal ? Number(cfg.nominaJornadaSemanal) : 40,
      empleados: prenominas.map((pr) => ({
        id: pr.id,
        empleadoId: pr.empleadoId,
        nombre: pr.empleado.nombre,
        apellidos: pr.empleado.apellidos,
        email: pr.empleado.email,
        dni: pr.empleado.dni,
        estado: pr.estado,
        horasTrabajadas: Number(pr.horasTrabajadas),
        horasOrdinarias: Number(pr.horasOrdinarias),
        horasExtras: Number(pr.horasExtras),
        horasNocturnas: Number(pr.horasNocturnas),
        horasFestivas: Number(pr.horasFestivas),
        diasTrabajados: pr.diasTrabajados,
        diasAusenciaPagada: pr.diasAusenciaPagada,
        diasAusenciaNoPagada: pr.diasAusenciaNoPagada,
        salarioBase: Number(pr.salarioBase),
        importeHorasExtras: Number(pr.importeHorasExtras),
        importeNocturnidad: Number(pr.importeNocturnidad),
        importeFestivos: Number(pr.importeFestivos),
        importeConceptos: Number(pr.importeConceptos),
        totalBruto: Number(pr.totalBruto),
        moneda: pr.moneda,
        comentario: pr.comentario,
        calculadaAt: pr.calculadaAt,
        cerradaAt: pr.cerradaAt,
        cerradaPor: pr.cerradaPor ? `${pr.cerradaPor.nombre} ${pr.cerradaPor.apellidos}` : null,
        enviadaAt: pr.enviadaAt,
        conceptos: pr.conceptos.map((c) => ({
          id: c.id,
          tipo: c.tipo,
          descripcion: c.descripcion,
          cantidad: c.cantidad === null ? null : Number(c.cantidad),
          importe: Number(c.importe),
          notas: c.notas,
        })),
      })),
    });
  }),
);

export const POST = withTenant(
  withFeature("prenomina", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    // Recalcular/persistir prenóminas es gestión: solo el Administrador (OWNER).
    // (La lectura GET sí la conserva el Coordinador vía assertOwnerOrManager.)
    if (userRol !== Rol.OWNER) {
      return NextResponse.json({ error: "Solo el Administrador" }, { status: 403 });
    }

    const periodo = req.nextUrl.searchParams.get("periodo");
    const p = parsePeriodo(periodo);
    if (!p) {
      return NextResponse.json(
        { error: "Parámetro periodo requerido (YYYY-MM)" },
        { status: 400 },
      );
    }

    const cfg = await prisma.configuracionEmpresa.findUnique({
      where: { id: "singleton" },
    });
    if (!cfg) {
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 500 });
    }
    const reglas: ReglasNomina = {
      jornadaSemanal: Number(cfg.nominaJornadaSemanal),
      horaExtraFactor: Number(cfg.nominaHoraExtraFactor),
      plusNocturnidadActivo: cfg.nominaPlusNocturnidadActivo,
      nocturnidadDesde: cfg.nominaNocturnidadDesde,
      nocturnidadHasta: cfg.nominaNocturnidadHasta,
      plusNocturnidadFactor: Number(cfg.nominaPlusNocturnidadFactor),
      plusFestivoActivo: cfg.nominaPlusFestivoActivo,
      plusFestivoFactor: Number(cfg.nominaPlusFestivoFactor),
      salarioBaseDefault: Number(cfg.nominaSalarioBaseDefault),
      moneda: cfg.nominaMoneda,
    };

    let diasLab = 0;
    for (let d = new Date(p.inicio); d <= p.fin; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.getUTCDay();
      if (day !== 0 && day !== 6) diasLab++;
    }
    const horasTeoricasMes = diasLab * (cfg.horasJornadaDiaria ?? 8);

    // Datos crudos.
    const scope = await resolveEmpresaScope(session);
    const empleados = await prisma.user.findMany({
      where: { activo: true, ...userScopeFilter(scope) },
      select: { id: true, salarioBase: true },
    });
    const empleadosIds = empleados.map((e) => e.id);
    const salarioPorEmpleado = new Map(
      empleados.map((e) => [e.id, e.salarioBase != null ? Number(e.salarioBase) : null] as const),
    );

    const fichajes = await prisma.fichaje.findMany({
      where: { timestamp: { gte: p.inicio, lte: p.fin } },
      orderBy: [{ userId: "asc" }, { timestamp: "asc" }],
      select: { userId: true, tipo: true, timestamp: true },
    });

    const ausenciasRaw = await prisma.ausencia.findMany({
      where: {
        estado: "APROBADA",
        fechaInicio: { lte: p.fin },
        fechaFin: { gte: p.inicio },
      },
      select: {
        userId: true,
        fechaInicio: true,
        fechaFin: true,
        tipoAusencia: { select: { pagada: true } },
      },
    });
    const ausencias = ausenciasRaw.map((a) => ({
      userId: a.userId,
      fechaInicio: a.fechaInicio,
      fechaFin: a.fechaFin,
      pagada: a.tipoAusencia?.pagada ?? true,
    }));

    const festivosDb = await prisma.festivo.findMany({
      where: { fecha: { gte: p.inicio, lte: p.fin } },
      select: { fecha: true },
    }).catch(() => [] as Array<{ fecha: Date }>);

    const calculos = calcularPrenomina(
      empleadosIds,
      fichajes.map((f) => ({
        userId: f.userId,
        tipo: f.tipo as TipoFichaje,
        timestamp: f.timestamp,
      })),
      ausencias,
      festivosDb,
      reglas,
      p.inicio,
      p.fin,
      horasTeoricasMes,
    );

    const ahora = new Date();
    let creadas = 0;
    let actualizadas = 0;
    let saltadas = 0;

    for (const [uid, calc] of calculos) {
      const salarioBase = salarioPorEmpleado.get(uid) ?? reglas.salarioBaseDefault;
      aplicarImportes(calc, salarioBase, horasTeoricasMes, reglas);

      // Buscar prenómina existente.
      const existing = await prisma.prenomina.findUnique({
        where: { periodo_empleadoId: { periodo: periodo!, empleadoId: uid } },
        select: { id: true, estado: true, importeConceptos: true },
      });
      if (existing && existing.estado !== "BORRADOR") {
        saltadas++;
        continue;
      }
      const totalBruto =
        Math.round(
          (salarioBase +
            calc.importeHorasExtras +
            calc.importeNocturnidad +
            calc.importeFestivos +
            (existing ? Number(existing.importeConceptos) : 0)) *
            100,
        ) / 100;

      const data = {
        estado: "BORRADOR" as const,
        horasTrabajadas: calc.horasTrabajadas,
        horasOrdinarias: calc.horasOrdinarias,
        horasExtras: calc.horasExtras,
        horasNocturnas: calc.horasNocturnas,
        horasFestivas: calc.horasFestivas,
        diasTrabajados: calc.diasTrabajados,
        diasAusenciaPagada: calc.diasAusenciaPagada,
        diasAusenciaNoPagada: calc.diasAusenciaNoPagada,
        salarioBase,
        importeHorasExtras: calc.importeHorasExtras,
        importeNocturnidad: calc.importeNocturnidad,
        importeFestivos: calc.importeFestivos,
        totalBruto,
        moneda: reglas.moneda,
        calculadaAt: ahora,
      };
      if (existing) {
        await prisma.prenomina.update({ where: { id: existing.id }, data });
        actualizadas++;
      } else {
        await prisma.prenomina.create({
          data: { ...data, periodo: periodo!, empleadoId: uid },
        });
        creadas++;
      }
    }

    return NextResponse.json({
      ok: true,
      periodo,
      creadas,
      actualizadas,
      saltadas,
    });
  }),
);
