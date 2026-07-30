/**
 * POST /api/articulos-venta/importar — sube el catálogo de artículos y
 * servicios desde un Excel o un CSV. Solo administración.
 *
 * Qué hace con lo que ya había:
 *  - Un artículo que vuelve a aparecer se actualiza (categoría y orden) y se
 *    reactiva si estaba desactivado.
 *  - Uno que ya no aparece NO se borra: se marca inactivo. Borrarlo se llevaría
 *    por delante la trazabilidad de las ventas ya registradas con él.
 *
 * El fichero llega en base64 porque es lo que sabe enviar el navegador sin
 * montar un endpoint multipart, y estas tablas son de kilobytes.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { construirCatalogo, parsearCSV } from "@/lib/cierre-turno/catalogo";
import { leerHojaExcel } from "@/lib/cierre-turno/catalogo-excel";

/** Tope del fichero de catálogo: una tabla de 500 artículos no llega ni a 100 KB. */
const MAX_BYTES = 2 * 1024 * 1024;

export const POST = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    if (rol !== "OWNER") {
      return NextResponse.json(
        { error: "Solo un administrador puede cambiar el catálogo de ventas." },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => null)) as {
      nombreFichero?: unknown;
      contenidoBase64?: unknown;
    } | null;
    if (!body || typeof body.contenidoBase64 !== "string") {
      return NextResponse.json({ error: "Sube un archivo Excel o CSV." }, { status: 400 });
    }

    const nombreFichero = typeof body.nombreFichero === "string" ? body.nombreFichero : "";
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
      console.error("[articulos-venta/importar] no se pudo leer el archivo:", err);
      return NextResponse.json(
        { error: "No hemos podido leer el archivo. Guárdalo como .xlsx o .csv y vuelve a intentarlo." },
        { status: 400 },
      );
    }

    const { filas, ignoradas, conCabecera } = construirCatalogo(matriz);
    if (filas.length === 0) {
      return NextResponse.json(
        {
          error: "No hemos encontrado ningún artículo en el archivo.",
          ignoradas: ignoradas.slice(0, 10),
        },
        { status: 400 },
      );
    }

    const resumen = await prisma.$transaction(async (tx) => {
      const previos = await tx.articuloVenta.findMany({ select: { id: true, nombre: true, activo: true } });
      const porNombre = new Map(previos.map((p) => [p.nombre.trim().toLowerCase(), p]));

      let creados = 0;
      let actualizados = 0;
      const idsEnFichero: string[] = [];

      for (const fila of filas) {
        const existente = porNombre.get(fila.nombre.toLowerCase());
        if (existente) {
          await tx.articuloVenta.update({
            where: { id: existente.id },
            data: {
              categoria: fila.categoria,
              orden: fila.orden,
              activo: true,
              // Sin columna de precio en la hoja no se borra el que ya hubiera:
              // puede haberlo puesto a mano y una reimportación de nombres no
              // debería llevárselo por delante.
              ...(fila.precio !== null ? { precio: fila.precio } : {}),
            },
          });
          idsEnFichero.push(existente.id);
          actualizados += 1;
        } else {
          const nuevo = await tx.articuloVenta.create({
            data: {
              nombre: fila.nombre,
              categoria: fila.categoria,
              orden: fila.orden,
              precio: fila.precio,
            },
            select: { id: true },
          });
          idsEnFichero.push(nuevo.id);
          creados += 1;
        }
      }

      // Los que ya no vienen se desactivan, no se borran: las ventas
      // registradas con ellos tienen que seguir siendo legibles.
      const desactivados = await tx.articuloVenta.updateMany({
        where: { id: { notIn: idsEnFichero }, activo: true },
        data: { activo: false },
      });

      return { creados, actualizados, desactivados: desactivados.count };
    });

    return NextResponse.json({
      ok: true,
      fichero: nombreFichero,
      conCabecera,
      // La hoja traía precios: la pantalla lo usa para ofrecer encender el
      // interruptor de precios si el cliente aún lo tiene apagado.
      conPrecios: filas.some((f) => f.precio !== null),
      ...resumen,
      ignoradas: ignoradas.slice(0, 20),
      totalIgnoradas: ignoradas.length,
    });
  }),
);
