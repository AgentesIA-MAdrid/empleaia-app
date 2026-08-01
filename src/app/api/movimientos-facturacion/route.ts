/**
 * Lo que consta facturado en el sistema del operador, importado de su Excel
 * (ticket 4b8e1d05).
 *
 * Sirve para cuadrar lo que los empleados declaran haber vendido con lo que de
 * verdad se metió a facturar: una venta declarada que nunca se tramitó no
 * aparece aquí, y un importe facturado sin venta declarada tampoco cuadra.
 *
 * Es el mismo circuito que el del extracto bancario —previsualizar, confirmar el
 * mapeo de columnas, importar sin duplicar— y comparte con él la lógica de
 * lectura (`lib/cierre-turno/banco.ts`), porque el problema es idéntico: un
 * fichero de un tercero con la fecha en una columna y el importe en otra.
 *
 * GET  /api/movimientos-facturacion?desde=&hasta=&tiendaId=  — lo ya importado.
 * POST /api/movimientos-facturacion — sube el Excel o el CSV del operador.
 *      · `previsualizar: true` → no guarda nada: devuelve las primeras filas y
 *        el mapeo propuesto para que el cliente confirme qué columna es qué.
 *      · `mapeo` → el mapeo a usar (y, con `guardarMapeo`, se recuerda para la
 *        próxima vez en `ConfiguracionEmpresa.facturacionMapeo`).
 * DELETE /api/movimientos-facturacion?id=… — quita una línea mal importada.
 *
 * Solo administración.
 *
 * La importación es idempotente por `referencia`: si el fichero no trae una, se
 * genera determinista a partir de la propia línea. Volver a subir el mismo
 * fichero —que es lo que pasa siempre— no duplica nada.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { parsearCSV } from "@/lib/cierre-turno/catalogo";
import { leerHojaExcel } from "@/lib/cierre-turno/catalogo-excel";
import {
  leerMovimientosBanco,
  normalizarMapeo,
  proponerMapeo,
  MAPEO_BANCO_DEFECTO,
  type MapeoBanco,
} from "@/lib/cierre-turno/banco";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Tope del fichero: un extracto anual en xlsx no llega a esto. */
const MAX_BYTES = 5 * 1024 * 1024;
const DIA_MS = 86_400_000;

async function esAdmin(): Promise<{ ok: true; userId: string } | { ok: false; res: NextResponse }> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rol = (session.user as any).rol as string;
  if (rol !== "OWNER") {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "La facturación la gestiona administración." },
        { status: 403 },
      ),
    };
  }
  return { ok: true, userId: session.user.id! };
}

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const quien = await esAdmin();
    if (!quien.ok) return quien.res;

    const url = new URL(req.url);
    const desdeStr = url.searchParams.get("desde");
    const hastaStr = url.searchParams.get("hasta");
    if ((desdeStr && !FECHA_RE.test(desdeStr)) || (hastaStr && !FECHA_RE.test(hastaStr))) {
      return NextResponse.json({ error: "Las fechas tienen que venir como AAAA-MM-DD." }, { status: 400 });
    }
    const tiendaId = url.searchParams.get("tiendaId") || null;

    const movimientos = await prisma.movimientoFacturacion.findMany({
      where: {
        ...(desdeStr || hastaStr
          ? {
              fecha: {
                ...(desdeStr ? { gte: new Date(`${desdeStr}T00:00:00Z`) } : {}),
                ...(hastaStr ? { lt: new Date(new Date(`${hastaStr}T00:00:00Z`).getTime() + DIA_MS) } : {}),
              },
            }
          : {}),
        ...(tiendaId ? { tiendaId } : {}),
      },
      select: {
        id: true,
        fecha: true,
        importe: true,
        concepto: true,
        referencia: true,
        importadoEn: true,
        tienda: { select: { id: true, nombre: true } },
      },
      orderBy: [{ fecha: "desc" }, { importadoEn: "desc" }],
      take: 500,
    });

    const cfg = await prisma.configuracionEmpresa.findUnique({
      where: { id: "singleton" },
      select: { facturacionMapeo: true },
    });

    return NextResponse.json({
      movimientos: movimientos.map((m) => ({
        id: m.id,
        fecha: m.fecha.toISOString().slice(0, 10),
        importe: Number(m.importe),
        concepto: m.concepto,
        referencia: m.referencia,
        sede: m.tienda,
        importadoEn: m.importadoEn.toISOString(),
      })),
      total: movimientos.reduce((n, m) => n + Number(m.importe), 0),
      // El mapeo guardado, para que la pantalla lo precargue.
      mapeoGuardado: (cfg?.facturacionMapeo as MapeoBanco | null) ?? null,
    });
  }),
);

export const POST = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const quien = await esAdmin();
    if (!quien.ok) return quien.res;

    const body = (await req.json().catch(() => null)) as {
      nombreFichero?: unknown;
      contenidoBase64?: unknown;
      tiendaId?: unknown;
      mapeo?: unknown;
      previsualizar?: unknown;
      guardarMapeo?: unknown;
    } | null;
    if (!body || typeof body.contenidoBase64 !== "string") {
      return NextResponse.json({ error: "Sube el Excel o el CSV del sistema de facturación." }, { status: 400 });
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(body.contenidoBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
    } catch {
      return NextResponse.json({ error: "No se ha podido leer el archivo." }, { status: 400 });
    }
    if (buf.byteLength === 0) return NextResponse.json({ error: "El archivo está vacío." }, { status: 400 });
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "El archivo pasa de 5 MB." }, { status: 400 });
    }

    // xlsx empieza por "PK" (es un zip); si no, se trata como texto.
    const esZip = buf[0] === 0x50 && buf[1] === 0x4b;
    let matriz: unknown[][];
    try {
      matriz = esZip ? await leerHojaExcel(buf) : parsearCSV(buf.toString("utf8"));
    } catch (err) {
      console.error("[movimientos-facturacion] no se pudo leer el archivo:", err);
      return NextResponse.json(
        { error: "No hemos podido leer el archivo. Guárdalo como .xlsx o .csv y vuelve a intentarlo." },
        { status: 400 },
      );
    }
    if (matriz.length === 0) {
      return NextResponse.json({ error: "El archivo no tiene ninguna fila." }, { status: 400 });
    }

    const tiendaId = typeof body.tiendaId === "string" && body.tiendaId ? body.tiendaId : null;
    if (tiendaId) {
      const existe = await prisma.tienda.findUnique({ where: { id: tiendaId }, select: { id: true } });
      if (!existe) return NextResponse.json({ error: "Esa sede no existe." }, { status: 404 });
    }

    // ─── Previsualización: no se guarda nada ──────────────────────────────
    // Con un export desconocido, adivinar y guardar a la vez es la forma más
    // rápida de meter 300 importes mal leídos en la conciliación.
    if (body.previsualizar === true) {
      const primera = (matriz[0] ?? []).map((c) => String(c ?? ""));
      const cfg = await prisma.configuracionEmpresa.findUnique({
        where: { id: "singleton" },
        select: { facturacionMapeo: true },
      });
      const guardado = cfg?.facturacionMapeo ? normalizarMapeo(cfg.facturacionMapeo) : null;
      const propuesta = proponerMapeo(primera);
      const mapeo = guardado?.ok ? guardado.mapeo : propuesta.mapeo;
      const muestra = leerMovimientosBanco(matriz.slice(0, 11), mapeo, tiendaId);

      return NextResponse.json({
        previsualizacion: true,
        cabeceras: primera,
        filas: matriz.slice(0, 6).map((f) => f.map((c) => String(c ?? ""))),
        mapeo,
        mapeoDe: guardado?.ok ? "guardado" : "propuesto",
        reconocidas: propuesta.reconocidas,
        muestra: muestra.movimientos.slice(0, 5).map((m) => ({
          fecha: m.fecha.toISOString().slice(0, 10),
          importe: m.importe,
          concepto: m.concepto,
          referencia: m.referencia,
        })),
        problemasMuestra: muestra.ignoradas.slice(0, 5),
      });
    }

    // ─── Importación de verdad ────────────────────────────────────────────
    let mapeo: MapeoBanco;
    if (body.mapeo !== undefined) {
      const v = normalizarMapeo(body.mapeo);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
      mapeo = v.mapeo;
    } else {
      const cfg = await prisma.configuracionEmpresa.findUnique({
        where: { id: "singleton" },
        select: { facturacionMapeo: true },
      });
      const guardado = cfg?.facturacionMapeo ? normalizarMapeo(cfg.facturacionMapeo) : null;
      mapeo = guardado?.ok ? guardado.mapeo : MAPEO_BANCO_DEFECTO;
    }

    const { movimientos, ignoradas } = leerMovimientosBanco(matriz, mapeo, tiendaId);
    if (movimientos.length === 0) {
      return NextResponse.json(
        {
          error:
            "No hemos encontrado ninguna línea facturada en el archivo. Revisa qué columna es la fecha y cuál el importe.",
          ignoradas: ignoradas.slice(0, 10),
        },
        { status: 400 },
      );
    }

    // Idempotente por referencia: `skipDuplicates` deja fuera lo ya importado
    // sin reventar la importación entera.
    const creados = await prisma.movimientoFacturacion.createMany({
      data: movimientos.map((m) => ({
        tiendaId,
        fecha: m.fecha,
        importe: m.importe,
        concepto: m.concepto,
        referencia: m.referencia,
      })),
      skipDuplicates: true,
    });

    if (body.guardarMapeo === true) {
      // `upsert` y no `update`: la fila singleton de configuración se crea de
      // forma perezosa (la primera visita a Configuración), y un tenant que
      // nunca ha entrado ahí no tiene por qué perder el mapeo.
      await prisma.configuracionEmpresa.upsert({
        where: { id: "singleton" },
        // `as never`: el campo es Json y Prisma tipa el input de forma que no
        // acepta una interfaz nuestra directamente.
        create: { id: "singleton", facturacionMapeo: mapeo as never },
        update: { facturacionMapeo: mapeo as never },
      });
    }

    return NextResponse.json({
      ok: true,
      leidos: movimientos.length,
      importados: creados.count,
      yaEstaban: movimientos.length - creados.count,
      ignoradas: ignoradas.slice(0, 20),
      totalIgnoradas: ignoradas.length,
      importe: Math.round(movimientos.reduce((n, m) => n + m.importe, 0) * 100) / 100,
    });
  }),
);

export const DELETE = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const quien = await esAdmin();
    if (!quien.ok) return quien.res;

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Falta el movimiento." }, { status: 400 });

    const previo = await prisma.movimientoFacturacion.findUnique({ where: { id }, select: { id: true } });
    if (!previo) return NextResponse.json({ error: "Esa línea ya no existe." }, { status: 404 });
    await prisma.movimientoFacturacion.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }),
);
