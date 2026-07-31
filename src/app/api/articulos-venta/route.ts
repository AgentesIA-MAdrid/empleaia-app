/**
 * GET /api/articulos-venta — catálogo de artículos y servicios que se venden.
 *
 * Es la base de la tabla del paso 1 del cierre. El catálogo se sube desde Excel
 * o CSV (ver `importar/`) y se retoca aquí; mientras esté vacío, el asistente
 * avisa de que falta en vez de mostrar una tabla sin filas.
 *
 * POST /api/articulos-venta — añade un artículo a mano. Solo administración.
 * El Excel resuelve el catálogo largo; quien vende cuatro o cinco conceptos
 * (pospago, fibra, renove, prepago, energía…) no debería tener que montar una
 * hoja de cálculo para empezar.
 *
 * PATCH /api/articulos-venta — retoca un artículo (nombre, categoría,
 * subcategoría, orden, precio, si cuenta para los objetivos) o lo desactiva.
 * Solo administración.
 * Nunca se borra: las ventas ya registradas con él tienen que seguir siendo
 * legibles.
 *
 * Lo que no se puede repetir es el mismo nombre en el mismo sitio del catálogo
 * (misma categoría y misma subcategoría): ahí serían dos filas idénticas en la
 * tabla del cierre. El mismo nombre en otra categoría sí vale —"Renove" de
 * Telefonía y "Renove" de Energía son dos productos distintos, con su precio y
 * sus objetivos— (ticket b4afccf5).
 *
 * `cuentaParaObjetivos` decide si sus unidades empujan los objetivos de
 * unidades totales y los del grupo (su categoría). Apagarlo no lo quita del
 * cierre: se sigue vendiendo y registrando igual (ticket 714c76dd).
 *
 * El precio es opcional y solo se usa si el cliente enciende los precios
 * (`ventasPreciosActivos`); el GET devuelve ese interruptor para que la
 * pantalla sepa si tiene sentido mostrar la columna.
 *
 * Con `?todos=1` el GET devuelve además `objetivosDelMes`: sobre qué productos
 * y sobre qué grupos hay objetivos puestos este mes. Con eso la pantalla del
 * catálogo pinta, en cada artículo, cómo se le evalúa —por sí solo o dentro de
 * su grupo— sin tener que ir a la parrilla de objetivos (ticket cd804fa2).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid } from "@/lib/cierre-turno/core";
import {
  CATALOGO_MAX_FILAS,
  claveArticulo,
  normalizarCategoriaArticulo,
  normalizarNombreArticulo,
  parsearPrecio,
} from "@/lib/cierre-turno/catalogo";

/** Campos que devuelven todos los handlers de esta ruta. */
const CAMPOS_ARTICULO = {
  id: true,
  nombre: true,
  categoria: true,
  subcategoria: true,
  orden: true,
  activo: true,
  precio: true,
  cuentaParaObjetivos: true,
} as const;

/**
 * El aviso de choque, diciendo dónde está el artículo que ya hay: el nombre
 * solo no basta para que el administrador sepa cuál de sus bloques revisar.
 */
function yaExiste(categoria: string | null, subcategoria: string | null): string {
  const donde = categoria
    ? `en "${categoria}"${subcategoria ? ` → "${subcategoria}"` : ""}`
    : "sin categoría";
  return `Ya tienes un artículo con ese nombre ${donde}. Si es otro producto, ponle otra categoría o subcategoría.`;
}

/** Solo administración toca el catálogo; el resto lo consulta. */
async function soloAdministracion(): Promise<Response | null> {
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
  return null;
}

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // ?todos=1 → también los desactivados, para la pantalla de administración.
    const url = new URL(req.url);
    const todos = url.searchParams.get("todos") === "1";

    // Los objetivos son mensuales, así que "cómo se evalúa este producto" es
    // siempre "este mes": se mira el mes en curso en horario peninsular, el
    // mismo criterio que `/api/objetivos-venta`.
    const mesObjetivos = diaMadrid().slice(0, 7);

    const [articulos, cfg, objetivos] = await Promise.all([
      prisma.articuloVenta.findMany({
        ...(todos ? {} : { where: { activo: true } }),
        select: CAMPOS_ARTICULO,
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      }),
      prisma.configuracionEmpresa.findUnique({
        where: { id: "singleton" },
        select: { ventasPreciosActivos: true, cierreTurnoEnRodaje: true },
      }),
      // Solo para la pantalla de administración: el cierre del comercial no
      // pinta distintivos y no hay por qué hacerle una consulta de más.
      todos
        ? prisma.objetivoVenta.findMany({
            // Un objetivo de 0 unidades es uno borrado a medias: no persigue
            // nada y no debería teñir el producto.
            where: { mes: mesObjetivos, cantidad: { gt: 0 } },
            select: { articuloId: true, categoria: true },
          })
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      // El precio viaja como número (o null): Decimal serializado a string
      // obligaría a parsearlo en cada pantalla.
      articulos: articulos.map((a) => ({ ...a, precio: a.precio === null ? null : Number(a.precio) })),
      catalogoVacio: articulos.filter((a) => a.activo).length === 0,
      preciosActivos: cfg?.ventasPreciosActivos ?? false,
      // Sin fila de configuración se asume rodaje (lado prudente).
      enRodaje: cfg?.cierreTurnoEnRodaje ?? true,
      // Sin `?todos=1` no se manda la clave (en vez de mandarla vacía, que se
      // leería como "aquí nadie persigue nada").
      ...(todos
        ? {
            objetivosDelMes: {
              mes: mesObjetivos,
              articuloIds: [
                ...new Set(
                  objetivos.map((o) => o.articuloId).filter((id): id is string => Boolean(id)),
                ),
              ],
              categorias: [
                ...new Set(objetivos.map((o) => o.categoria).filter((c): c is string => Boolean(c))),
              ],
            },
          }
        : {}),
    });
  }),
);

export const POST = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const veto = await soloAdministracion();
    if (veto) return veto;

    const body = (await req.json().catch(() => null)) as {
      nombre?: unknown;
      categoria?: unknown;
      subcategoria?: unknown;
      precio?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

    const nombreOk = normalizarNombreArticulo(body.nombre);
    if (!nombreOk.ok) return NextResponse.json({ error: nombreOk.error }, { status: 400 });
    const categoria = normalizarCategoriaArticulo(body.categoria);
    // Mismas reglas que la categoría: es el segundo nivel del mismo árbol.
    const subcategoria = normalizarCategoriaArticulo(body.subcategoria);

    let precio: number | null = null;
    if (body.precio !== undefined && body.precio !== null && body.precio !== "") {
      precio = parsearPrecio(String(body.precio));
      if (precio === null) {
        return NextResponse.json({ error: "El precio no es válido." }, { status: 400 });
      }
    }

    // Todo en una transacción: entre mirar si el sitio está cogido y crear la
    // fila no puede colarse otra pestaña con el mismo artículo.
    const resultado = await prisma.$transaction(async (tx) => {
      const previos = await tx.articuloVenta.findMany({
        select: { id: true, nombre: true, categoria: true, subcategoria: true, activo: true, orden: true },
      });

      // El mismo nombre en otra categoría (o subcategoría) es otro artículo:
      // "Renove" de Telefonía y "Renove" de Energía se venden por separado,
      // tienen su precio y sus objetivos, y el cliente los quiere los dos.
      const clave = claveArticulo({ nombre: nombreOk.nombre, categoria, subcategoria });
      const existente = previos.find((p) => claveArticulo(p) === clave);
      if (existente?.activo) return { estado: "duplicado" as const };
      if (existente) {
        // Estaba desactivado, en esta misma categoría: se reactiva en vez de
        // crear un gemelo, para que las ventas que ya se registraron con él
        // sigan sumando en el mismo artículo.
        const revivido = await tx.articuloVenta.update({
          where: { id: existente.id },
          data: {
            nombre: nombreOk.nombre,
            categoria,
            subcategoria,
            activo: true,
            ...(precio !== null ? { precio } : {}),
          },
          select: CAMPOS_ARTICULO,
        });
        return { estado: "reactivado" as const, articulo: revivido };
      }

      if (previos.filter((p) => p.activo).length >= CATALOGO_MAX_FILAS) {
        return { estado: "lleno" as const };
      }

      // Al final de la lista: el orden del catálogo es el orden en que el
      // comercial ve la tabla, y lo nuevo se añade abajo.
      const orden = previos.reduce((max, p) => Math.max(max, p.orden), -1) + 1;
      const nuevo = await tx.articuloVenta.create({
        data: { nombre: nombreOk.nombre, categoria, subcategoria, orden, precio },
        select: CAMPOS_ARTICULO,
      });
      return { estado: "creado" as const, articulo: nuevo };
    });

    if (resultado.estado === "duplicado") {
      return NextResponse.json({ error: yaExiste(categoria, subcategoria) }, { status: 409 });
    }
    if (resultado.estado === "lleno") {
      return NextResponse.json(
        { error: `El catálogo no admite más de ${CATALOGO_MAX_FILAS} artículos activos.` },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        ...resultado.articulo,
        precio: resultado.articulo.precio === null ? null : Number(resultado.articulo.precio),
        reactivado: resultado.estado === "reactivado",
      },
      { status: 201 },
    );
  }),
);

export const PATCH = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const veto = await soloAdministracion();
    if (veto) return veto;

    const body = (await req.json().catch(() => null)) as {
      id?: unknown;
      nombre?: unknown;
      categoria?: unknown;
      subcategoria?: unknown;
      orden?: unknown;
      activo?: unknown;
      precio?: unknown;
      cuentaParaObjetivos?: unknown;
    } | null;
    if (!body || typeof body.id !== "string") {
      return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
    }

    const data: {
      nombre?: string;
      categoria?: string | null;
      subcategoria?: string | null;
      orden?: number;
      activo?: boolean;
      precio?: number | null;
      cuentaParaObjetivos?: boolean;
    } = {};
    if (body.nombre !== undefined) {
      const nombreOk = normalizarNombreArticulo(body.nombre);
      if (!nombreOk.ok) return NextResponse.json({ error: nombreOk.error }, { status: 400 });
      data.nombre = nombreOk.nombre;
    }
    if (body.categoria !== undefined) {
      data.categoria = normalizarCategoriaArticulo(body.categoria);
    }
    if (body.subcategoria !== undefined) {
      data.subcategoria = normalizarCategoriaArticulo(body.subcategoria);
    }
    if (typeof body.orden === "number" && Number.isInteger(body.orden) && body.orden >= 0) {
      data.orden = body.orden;
    }
    if (typeof body.activo === "boolean") data.activo = body.activo;
    if (typeof body.cuentaParaObjetivos === "boolean") {
      data.cuentaParaObjetivos = body.cuentaParaObjetivos;
    }
    // Vaciar el campo en la pantalla borra el precio (queda "sin precio"), no
    // lo pone a cero: cero es un artículo gratis, y no es lo mismo.
    if (body.precio !== undefined) {
      if (body.precio === null || body.precio === "") {
        data.precio = null;
      } else {
        const p = parsearPrecio(String(body.precio));
        if (p === null) {
          return NextResponse.json({ error: "El precio no es válido." }, { status: 400 });
        }
        data.precio = p;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No hay nada que cambiar." }, { status: 400 });
    }

    // Renombrar —o mover de categoría— no puede acabar en dos artículos iguales
    // dentro del mismo bloque: el importador los daría por el mismo y la tabla
    // del cierre mostraría dos filas idénticas que nadie sabría distinguir. Dos
    // con el mismo nombre en categorías distintas sí valen: son dos productos.
    if (data.nombre !== undefined || data.categoria !== undefined || data.subcategoria !== undefined) {
      const [actual, otros] = await Promise.all([
        prisma.articuloVenta.findUnique({
          where: { id: body.id },
          select: { nombre: true, categoria: true, subcategoria: true },
        }),
        prisma.articuloVenta.findMany({
          where: { id: { not: body.id } },
          select: { nombre: true, categoria: true, subcategoria: true },
        }),
      ]);
      if (!actual) {
        return NextResponse.json({ error: "Ese artículo ya no existe." }, { status: 404 });
      }
      // Los campos que no vienen en el PATCH se quedan como están: la pantalla
      // guarda una casilla cada vez, así que el choque hay que mirarlo sobre
      // cómo queda el artículo entero, no sobre lo que llega suelto.
      const destino = {
        nombre: data.nombre ?? actual.nombre,
        categoria: data.categoria !== undefined ? data.categoria : actual.categoria,
        subcategoria: data.subcategoria !== undefined ? data.subcategoria : actual.subcategoria,
      };
      const clave = claveArticulo(destino);
      if (otros.some((o) => claveArticulo(o) === clave)) {
        return NextResponse.json(
          { error: yaExiste(destino.categoria, destino.subcategoria) },
          { status: 409 },
        );
      }
    }

    const actualizado = await prisma.articuloVenta.update({
      where: { id: body.id },
      data,
      select: CAMPOS_ARTICULO,
    });
    return NextResponse.json({
      ...actualizado,
      precio: actualizado.precio === null ? null : Number(actualizado.precio),
    });
  }),
);
