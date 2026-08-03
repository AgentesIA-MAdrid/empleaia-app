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
 * Lo que NO se toca aquí:
 *
 *  - El **saldo esperado** (`saldoEsperado`), que se deriva del acumulado de la
 *    caja. Si lo que está mal es el acumulado, se arregla su saldo de partida,
 *    no el arqueo: si no, cuadraría a base de mover la vara de medir.
 *  - El **arranque de la semana siguiente**. El dinero salió del cajón al sobre
 *    cuando se declaró; corregir cuánto había en el sobre no lo devuelve a la
 *    caja.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { esDescuadre } from "@/lib/cierre-turno/core";
import { diferenciaSaldo } from "@/lib/cierre-turno/saldo-caja";
import { normalizarEfectivoArqueo } from "@/lib/cierre-turno/arqueos";
import { umbralDescuadre } from "@/lib/cierre-turno/caja-queries";

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

    const declaradoAntes = Number(arqueo.efectivoDeclarado);
    const recogidoAntes = arqueo.efectivoRecogido === null ? null : Number(arqueo.efectivoRecogido);
    const sinCambios = declaradoAntes === declarado.importe && recogidoAntes === recogido;
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
        },
      });
      await tx.arqueoCorreccion.create({
        data: {
          arqueoId: arqueo.id,
          declaradoAntes,
          recogidoAntes,
          declaradoDespues: declarado.importe,
          recogidoDespues: recogido,
          motivo: motivo.slice(0, MOTIVO_MAX),
          corregidoPorId: userId,
        },
      });
    });

    const esperado = arqueo.saldoEsperado === null ? null : Number(arqueo.saldoEsperado);
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
