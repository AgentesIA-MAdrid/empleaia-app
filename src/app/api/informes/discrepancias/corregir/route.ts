/**
 * POST /api/informes/discrepancias/corregir — arregla el cuadrante desde el
 * cuadro de discrepancias del informe (ticket c1e94a7b).
 *
 * Body: `{ userId, dia: "YYYY-MM-DD", tipo }`. El servidor vuelve a mirar los
 * datos y decide qué hacer (`planificarCorreccion`): no se acepta un plan que
 * venga del cliente, porque sería aceptar que alguien reescriba el cuadrante
 * mandando un turno y una sede a mano.
 *
 * Qué hace en cada caso:
 *
 *  - `sede_distinta` → cambia la sede del turno a la del fichaje.
 *  - `sin_turno` → crea el turno con las horas de sus fichajes de ese día.
 *  - `turno_sin_fichaje` → marca el turno como no realizado, sin borrarlo.
 *
 * En los tres: el turno queda `corregido` (amarillo en el cuadrante), con lo que
 * decía antes escrito en `notaCorreccion`, se apunta en el historial
 * (`CorreccionCuadrante`) y —cuando hay fichaje— se añade a su nota el turno
 * original, para que abriendo el fichaje se vea de dónde venía.
 *
 * Solo administración: reescribir el cuadrante no es cosa de quien lo trabaja.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { partesEnZona } from "@/lib/fichajes/horario-turno";
import {
  planificarCorreccion,
  type TipoDiscrepancia,
} from "@/lib/informes/corregir-cuadrante";

const TIPOS: TipoDiscrepancia[] = ["sede_distinta", "sin_turno", "turno_sin_fichaje"];
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export const POST = withTenant(
  withFeature("informes_avanzados", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    if (rol !== "OWNER") {
      return NextResponse.json(
        { error: "El cuadrante lo corrige administración." },
        { status: 403 },
      );
    }
    const autorId = session.user.id!;

    const body = (await req.json().catch(() => null)) as {
      userId?: unknown;
      dia?: unknown;
      tipo?: unknown;
    } | null;
    const userId = typeof body?.userId === "string" ? body.userId : "";
    const dia = typeof body?.dia === "string" ? body.dia : "";
    const tipo = TIPOS.find((t) => t === body?.tipo);
    if (!userId || !DIA_RE.test(dia) || !tipo) {
      return NextResponse.json({ error: "Datos incompletos." }, { status: 400 });
    }

    const cfg = await prisma.configuracionEmpresa.findUnique({
      where: { id: "singleton" },
      select: { zonaHoraria: true },
    });
    const zona = cfg?.zonaHoraria ?? "Europe/Madrid";
    const fecha = new Date(`${dia}T00:00:00Z`);

    // Los fichajes del día en la zona del cliente: la ventana se abre a los dos
    // lados porque un día de Madrid empieza a las 22:00Z del anterior.
    const fichajes = await prisma.fichaje.findMany({
      where: {
        userId,
        timestamp: {
          gte: new Date(fecha.getTime() - 86_400_000),
          lte: new Date(fecha.getTime() + 2 * 86_400_000),
        },
      },
      select: { id: true, tipo: true, timestamp: true, tiendaId: true, nota: true },
      orderBy: { timestamp: "asc" },
    });
    const delDia = fichajes.filter((f) => partesEnZona(f.timestamp, zona).fecha === dia);
    const entrada = delDia.find((f) => f.tipo === "ENTRADA") ?? null;
    const salida = [...delDia].reverse().find((f) => f.tipo === "SALIDA") ?? null;

    const turnos = await prisma.turno.findMany({
      where: { userId, fecha },
      select: {
        id: true,
        horaInicio: true,
        horaFin: true,
        tiendaId: true,
        tienda: { select: { id: true, nombre: true } },
      },
    });
    // Con jornada partida se corrige el turno cuya sede NO cuadra con el
    // fichaje; si cuadran todos, ya no hay nada que corregir.
    const turno =
      tipo === "sede_distinta"
        ? (turnos.find((t) => t.tiendaId !== entrada?.tiendaId) ?? null)
        : (turnos[0] ?? null);

    const sedeFichaje = entrada?.tiendaId
      ? await prisma.tienda.findUnique({
          where: { id: entrada.tiendaId },
          select: {
            id: true,
            nombre: true,
            // El horario del día que se corrige: `diaSemana` va 0=domingo, como
            // `Date.getUTCDay()`.
            horarios: {
              where: { diaSemana: new Date(`${dia}T00:00:00Z`).getUTCDay() },
              select: { horaApertura: true, horaCierre: true },
              orderBy: { orden: "asc" },
            },
          },
        })
      : null;

    const plan = planificarCorreccion({
      tipo,
      turno: turno
        ? {
            id: turno.id,
            horaInicio: turno.horaInicio,
            horaFin: turno.horaFin,
            sedeNombre: turno.tienda?.nombre ?? null,
          }
        : null,
      fichaje: entrada
        ? { tiendaId: entrada.tiendaId, sedeNombre: sedeFichaje?.nombre ?? null }
        : null,
      horasFichadas: {
        entrada: entrada ? hhmmDe(entrada.timestamp, zona) : null,
        salida: salida ? hhmmDe(salida.timestamp, zona) : null,
      },
      horarioSede: sedeFichaje?.horarios?.[0]
        ? {
            apertura: sedeFichaje.horarios[0].horaApertura,
            cierre: sedeFichaje.horarios[0].horaCierre,
          }
        : null,
    });
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 409 });

    const notaTurno = `Corregido el ${new Date().toISOString().slice(0, 10)}: antes ${plan.plan.antes}.`;

    const turnoResultante = await prisma.$transaction(async (tx) => {
      let turnoId: string | null = null;

      if (plan.plan.accion === "cambiar_sede") {
        const t = await tx.turno.update({
          where: { id: plan.plan.turnoId },
          data: {
            tiendaId: plan.plan.tiendaId,
            corregido: true,
            notaCorreccion: notaTurno,
          },
          select: { id: true },
        });
        turnoId = t.id;
      } else if (plan.plan.accion === "crear_turno") {
        const t = await tx.turno.create({
          data: {
            userId,
            tiendaId: plan.plan.tiendaId,
            fecha,
            horaInicio: plan.plan.horaInicio,
            horaFin: plan.plan.horaFin,
            // Publicado: es un turno que ya se ha trabajado, no un borrador.
            estado: "PUBLICADO",
            corregido: true,
            notaCorreccion: notaTurno,
          },
          select: { id: true },
        });
        turnoId = t.id;
      } else {
        const t = await tx.turno.update({
          where: { id: plan.plan.turnoId },
          data: { corregido: true, noRealizado: true, notaCorreccion: notaTurno },
          select: { id: true },
        });
        turnoId = t.id;
      }

      // El turno original, en la nota del fichaje: abriendo el fichaje se ve de
      // dónde venía. Se añade detrás de lo que hubiera.
      if (entrada) {
        const apunte = `Cuadrante corregido: antes ${plan.plan.antes} → ${plan.plan.despues}.`;
        await tx.fichaje.update({
          where: { id: entrada.id },
          data: { nota: entrada.nota ? `${entrada.nota} · ${apunte}` : apunte },
        });
      }

      await tx.correccionCuadrante.create({
        data: {
          turnoId,
          userId,
          fecha,
          tipo,
          antes: plan.plan.antes,
          despues: plan.plan.despues,
          corregidoPorId: autorId,
        },
      });

      return turnoId;
    });

    return NextResponse.json({
      ok: true,
      turnoId: turnoResultante,
      accion: plan.plan.accion,
      antes: plan.plan.antes,
      despues: plan.plan.despues,
    });
  }),
);

/** "HH:MM" de un instante en la zona del cliente. */
function hhmmDe(d: Date, zona: string): string {
  const { minutos } = partesEnZona(d, zona);
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}
