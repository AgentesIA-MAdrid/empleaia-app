/**
 * PUT /api/arqueos/corregir — administración corrige un arqueo (ticket 5a71fe28).
 *
 * Hasta ahora un arqueo ya recogido no lo podía tocar nadie: si el importe
 * estaba mal —se contó de más, se apuntó un dígito de menos, se firmó antes de
 * acabar de contar—, se quedaba mal para siempre. Ahora se corrige, y con el
 * rastro que la app ya le promete al empleado en el paso de caja: *"solo un
 * administrador podrá corregirlos, y quedará registrado quién lo cambió y por
 * qué"*.
 *
 * De ahí las tres reglas:
 *
 *  - **Solo OWNER.** No es un permiso de rol amplio: es la persona que responde
 *    del dinero de la empresa.
 *  - **Motivo obligatorio.** Un importe cambiado sin motivo no se puede auditar
 *    seis meses después, que es justo cuando hace falta.
 *  - **Cada corrección se guarda entera** (importes antes y después) en
 *    `ArqueoCorreccion`, no como un diff: un arqueo puede corregirse varias
 *    veces y lo que interesa es la cadena.
 *
 * El **acumulado esperado** (`saldoEsperado`) se congela al declarar y por
 * defecto no se toca: si se recalculara en cada corrección, el arqueo cuadraría
 * moviendo la vara de medir. Pero hay un caso en que sí hay que recalcularlo, y
 * pasó el primer fin de semana: el **saldo de partida de la tienda estaba mal**
 * (dato erróneo en el Excel de arranque) y se corrigió DESPUÉS de declarar el
 * arqueo, así que el arqueo se quedó comparado contra una cifra que ya no existe.
 * Para eso está `recalcularEsperado`, que lo pone al día con el cálculo de hoy y
 * lo deja anotado en el motivo.
 *
 * Lo que no se toca en ningún caso es el **arranque de la semana siguiente**: el
 * dinero salió del cajón al sobre cuando se declaró, y corregir cuánto había en
 * el sobre no lo devuelve a la caja.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { esDescuadre } from "@/lib/cierre-turno/core";
import { diferenciaSaldo } from "@/lib/cierre-turno/saldo-caja";
import { normalizarEfectivoArqueo, rangoSemanaISO } from "@/lib/cierre-turno/arqueos";
import { acumuladoDeSede, umbralDescuadre } from "@/lib/cierre-turno/caja-queries";

/** Un motivo de tres letras no es un motivo. */
const MOTIVO_MIN = 5;
const MOTIVO_MAX = 500;

export const PUT = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((session.user as any).rol !== "OWNER") {
      return NextResponse.json(
        { error: "Solo administración puede corregir un arqueo." },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => null)) as {
      arqueoId?: unknown;
      efectivoDeclarado?: unknown;
      efectivoRecogido?: unknown;
      motivo?: unknown;
      /** Poner al día el acumulado contra el que se compara. */
      recalcularEsperado?: unknown;
    } | null;
    if (!body || typeof body.arqueoId !== "string" || !body.arqueoId) {
      return NextResponse.json({ error: "Falta el arqueo." }, { status: 400 });
    }

    const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";
    if (motivo.length < MOTIVO_MIN) {
      return NextResponse.json(
        { error: "Escribe por qué lo corriges: queda registrado." },
        { status: 400 },
      );
    }

    const declarado = normalizarEfectivoArqueo(body.efectivoDeclarado);
    if (!declarado.ok) return NextResponse.json({ error: declarado.error }, { status: 400 });

    const arqueo = await prisma.arqueo.findUnique({
      where: { id: body.arqueoId },
      select: {
        id: true,
        semana: true,
        estado: true,
        efectivoDeclarado: true,
        efectivoRecogido: true,
        saldoEsperado: true,
        tiendaId: true,
        tienda: { select: { nombre: true } },
      },
    });
    if (!arqueo) return NextResponse.json({ error: "Ese arqueo ya no existe." }, { status: 404 });

    // Lo recogido solo tiene sentido en un arqueo firmado, y nunca más de lo
    // que la tienda declara: el responsable no puede llevarse lo que no había.
    let recogido: number | null =
      arqueo.efectivoRecogido === null ? null : Number(arqueo.efectivoRecogido);
    if (body.efectivoRecogido !== undefined) {
      if (arqueo.estado !== "recogido") {
        return NextResponse.json(
          { error: "Este arqueo aún no lo ha recogido nadie: no hay importe recogido que corregir." },
          { status: 400 },
        );
      }
      if (body.efectivoRecogido === null || body.efectivoRecogido === "") {
        recogido = null;
      } else {
        const v = normalizarEfectivoArqueo(body.efectivoRecogido);
        if (!v.ok) return NextResponse.json({ error: `Recogido: ${v.error}` }, { status: 400 });
        if (v.importe > declarado.importe) {
          return NextResponse.json(
            { error: "No se puede haber recogido más de lo que la tienda declaró." },
            { status: 400 },
          );
        }
        recogido = v.importe;
      }
    }

    // Recalcular el acumulado: solo cuando lo piden, y con el mismo cálculo que
    // usa la pantalla, para que no haya dos verdades.
    const esperadoAntes = arqueo.saldoEsperado === null ? null : Number(arqueo.saldoEsperado);
    let esperadoNuevo = esperadoAntes;
    if (body.recalcularEsperado === true) {
      const { hasta } = rangoSemanaISO(arqueo.semana);
      const saldo = await acumuladoDeSede(prisma, { tiendaId: arqueo.tiendaId, hasta });
      esperadoNuevo = saldo.esperado;
    }

    const declaradoAntes = Number(arqueo.efectivoDeclarado);
    const recogidoAntes = arqueo.efectivoRecogido === null ? null : Number(arqueo.efectivoRecogido);
    const sinCambios =
      declaradoAntes === declarado.importe &&
      recogidoAntes === recogido &&
      esperadoNuevo === esperadoAntes;
    if (sinCambios) {
      return NextResponse.json(
        { error: "Los importes son los mismos: no hay nada que corregir." },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.arqueo.update({
        where: { id: arqueo.id },
        data: {
          efectivoDeclarado: declarado.importe,
          ...(body.efectivoRecogido !== undefined ? { efectivoRecogido: recogido } : {}),
          ...(esperadoNuevo !== esperadoAntes ? { saldoEsperado: esperadoNuevo } : {}),
        },
      });
      await tx.arqueoCorreccion.create({
        data: {
          arqueoId: arqueo.id,
          declaradoAntes,
          recogidoAntes,
          declaradoDespues: declarado.importe,
          recogidoDespues: recogido,
          // El recálculo del acumulado se anota en el propio motivo: es parte de
          // lo que hay que poder auditar después.
          motivo: (esperadoNuevo !== esperadoAntes
            ? `${motivo} · Acumulado esperado recalculado: ${esperadoAntes ?? "—"} → ${esperadoNuevo ?? "—"}`
            : motivo
          ).slice(0, MOTIVO_MAX),
          corregidoPorId: userId,
        },
      });
    });

    const esperado = esperadoNuevo;
    const diferencia = diferenciaSaldo(declarado.importe, esperado);
    const umbral = await umbralDescuadre(prisma);

    return NextResponse.json({
      ok: true,
      arqueoId: arqueo.id,
      sede: arqueo.tienda.nombre,
      semana: arqueo.semana,
      declarado: declarado.importe,
      recogido,
      esperado,
      diferencia,
      descuadre: diferencia === null ? false : esDescuadre(diferencia, umbral),
    });
  }),
);
