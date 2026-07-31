/**
 * POST /api/objetivos-venta/importar — sube la plantilla de objetivos del mes
 * (la que descarga `/api/objetivos-venta/plantilla`) y aplica lo que trae.
 *
 * Reglas, las mismas que en la parrilla de la pantalla:
 *  - Una casilla vacía NO toca el objetivo que hubiera: la plantilla se rellena
 *    a medias muy a menudo y borrar lo que no se ha escrito sería destruir
 *    trabajo. Para quitar un objetivo se escribe 0.
 *  - Cantidad 0 borra el objetivo (no se guarda un cero, que se leería como un
 *    objetivo real de cero unidades).
 *  - Solo administración: coordinación consulta y descarga, pero no fija.
 *
 * El fichero llega en base64, igual que en `/api/articulos-venta/importar`: es
 * lo que sabe enviar el navegador sin montar un endpoint multipart, y estas
 * hojas son de kilobytes.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { puedeFijarObjetivos } from "@/lib/cierre-turno/core";
import { normalizarMes } from "@/lib/cierre-turno/objetivos";
import { interpretarPlantillaObjetivos } from "@/lib/cierre-turno/objetivos-plantilla";
import { leerHojaExcel } from "@/lib/cierre-turno/catalogo-excel";
import { parsearCSV } from "@/lib/cierre-turno/catalogo";

/** Tope del fichero: una plantilla de 200 filas no llega ni a 100 KB. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Clave de un objetivo dentro del mes (la de la unique de la tabla). */
function clave(o: {
  userId: string | null;
  tiendaId: string | null;
  articuloId: string | null;
  categoria: string | null;
}): string {
  return [o.userId ?? "", o.tiendaId ?? "", o.articuloId ?? "", o.categoria ?? ""].join("|");
}

export const POST = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    if (!puedeFijarObjetivos(rol)) {
      return NextResponse.json(
        { error: "Solo un administrador puede fijar objetivos de venta." },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => null)) as {
      mes?: unknown;
      nombreFichero?: unknown;
      contenidoBase64?: unknown;
    } | null;
    if (!body || typeof body.contenidoBase64 !== "string") {
      return NextResponse.json({ error: "Sube la plantilla en Excel o CSV." }, { status: 400 });
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(body.contenidoBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
    } catch {
      return NextResponse.json({ error: "No se ha podido leer el archivo." }, { status: 400 });
    }
    if (buf.byteLength === 0) {
      return NextResponse.json({ error: "El archivo está vacío." }, { status: 400 });
    }
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "El archivo pasa de 2 MB." }, { status: 400 });
    }

    // xlsx empieza por "PK" (es un zip); si no, lo tratamos como texto.
    const esZip = buf[0] === 0x50 && buf[1] === 0x4b;
    let matriz: string[][];
    try {
      matriz = esZip ? await leerHojaExcel(buf) : parsearCSV(buf.toString("utf8"));
    } catch (err) {
      console.error("[objetivos-venta/importar] no se pudo leer el archivo:", err);
      return NextResponse.json(
        {
          error:
            "No hemos podido leer el archivo. Guárdalo como .xlsx o .csv y vuelve a intentarlo.",
        },
        { status: 400 },
      );
    }

    const [articulos, sedes, personas] = await Promise.all([
      prisma.articuloVenta.findMany({
        where: { activo: true },
        select: { id: true, nombre: true, categoria: true, cuentaParaObjetivos: true },
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      }),
      prisma.tienda.findMany({
        where: { activa: true },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" },
      }),
      prisma.user.findMany({
        where: { activo: true },
        select: { id: true, nombre: true, apellidos: true },
        orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
      }),
    ]);

    const lectura = interpretarPlantillaObjetivos(matriz, {
      comerciales: personas.map((p) => ({ id: p.id, nombre: `${p.nombre} ${p.apellidos}`.trim() })),
      sedes,
      articulos,
    });
    if (!lectura.cabeceraEncontrada) {
      return NextResponse.json(
        {
          error:
            'No hemos encontrado la fila de encabezados. Descarga la plantilla desde "Descargar plantilla", rellénala y vuelve a subirla sin quitarle las cabeceras.',
        },
        { status: 400 },
      );
    }

    // El mes lo manda la pantalla; si no viene, vale el que trae escrito la
    // hoja. Si la hoja es de otro mes se para: importar los objetivos de junio
    // encima de los de julio no hay quien lo deshaga.
    const mesOk = normalizarMes(typeof body.mes === "string" ? body.mes : lectura.mes);
    if (!mesOk.ok) return NextResponse.json({ error: mesOk.error }, { status: 400 });
    const mes = mesOk.mes;
    if (lectura.mes && lectura.mes !== mes) {
      return NextResponse.json(
        {
          error: `Esa plantilla es del mes ${lectura.mes} y estás importando sobre ${mes}. Cambia el mes en pantalla o descarga la plantilla de ${mes}.`,
        },
        { status: 400 },
      );
    }

    if (lectura.cambios.length === 0) {
      return NextResponse.json(
        {
          error: "No hemos encontrado ningún objetivo escrito en la hoja.",
          ignoradas: lectura.ignoradas.slice(0, 10),
          columnasIgnoradas: lectura.columnasIgnoradas.slice(0, 10),
        },
        { status: 400 },
      );
    }

    const previos = await prisma.objetivoVenta.findMany({
      where: { mes },
      select: {
        id: true,
        userId: true,
        tiendaId: true,
        articuloId: true,
        categoria: true,
        cantidad: true,
      },
    });
    const porClave = new Map(previos.map((p) => [clave(p), p]));

    // Se calcula primero lo que cambia de verdad y solo eso se escribe: una
    // plantilla de 40 filas × 15 columnas son 600 casillas, y mandar 600
    // escrituras (cuando lo normal es que cambien cuatro) reventaría el tiempo
    // de la transacción.
    const aCrear: {
      mes: string;
      userId: string | null;
      tiendaId: string | null;
      articuloId: string | null;
      categoria: string | null;
      cantidad: number;
    }[] = [];
    const aActualizar: { id: string; cantidad: number }[] = [];
    const aBorrar: string[] = [];
    let sinCambios = 0;

    for (const c of lectura.cambios) {
      const fila = {
        userId: c.ambito === "comercial" ? c.sujetoId : null,
        tiendaId: c.ambito === "sede" ? c.sujetoId : null,
        articuloId: c.articuloId,
        categoria: c.categoria,
      };
      const previo = porClave.get(clave(fila));
      if (c.cantidad === 0) {
        if (previo) aBorrar.push(previo.id);
        else sinCambios += 1;
        continue;
      }
      if (!previo) {
        aCrear.push({ mes, ...fila, cantidad: c.cantidad });
        continue;
      }
      if (previo.cantidad === c.cantidad) sinCambios += 1;
      else aActualizar.push({ id: previo.id, cantidad: c.cantidad });
    }

    await prisma.$transaction(
      async (tx) => {
        if (aBorrar.length > 0) {
          await tx.objetivoVenta.deleteMany({ where: { id: { in: aBorrar } } });
        }
        for (const u of aActualizar) {
          await tx.objetivoVenta.update({ where: { id: u.id }, data: { cantidad: u.cantidad } });
        }
        if (aCrear.length > 0) {
          await tx.objetivoVenta.createMany({ data: aCrear });
        }
      },
      // Rehacer la parrilla entera de una empresa grande son cientos de
      // actualizaciones seguidas: con los 5 s por defecto de Prisma, una
      // importación así se quedaría a medias.
      { timeout: 30_000, maxWait: 10_000 },
    );

    return NextResponse.json({
      ok: true,
      mes,
      fichero: typeof body.nombreFichero === "string" ? body.nombreFichero : "",
      creados: aCrear.length,
      actualizados: aActualizar.length,
      borrados: aBorrar.length,
      sinCambios,
      ignoradas: lectura.ignoradas.slice(0, 20),
      totalIgnoradas: lectura.ignoradas.length,
      columnasIgnoradas: lectura.columnasIgnoradas.slice(0, 10),
    });
  }),
);
