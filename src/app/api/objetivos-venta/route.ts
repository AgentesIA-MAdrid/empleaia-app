/**
 * Objetivos de venta del mes (módulo "Cierre de turno", plan Enterprise).
 *
 * GET  /api/objetivos-venta?mes=YYYY-MM
 *   Devuelve las tres matrices listas para pintar: una fila por comercial, otra
 *   tanda de filas por sede y otra por grupo de objetivos (TMT, televenta…, los
 *   que haya dado de alta el cliente), con una columna por grupo de productos y
 *   por artículo del catálogo (más la de unidades totales) y en cada casilla el
 *   objetivo del mes, lo vendido y la consecución. Los objetivos personales,
 *   los de la sede y los del grupo son distintos y van en tablas separadas.
 *
 *   Un grupo de productos es la SUBCATEGORÍA del catálogo —con su categoría,
 *   que es lo que distingue dos subcategorías que se llamen igual—, y solo
 *   cuentan para los objetivos —de grupo y de unidades totales— los artículos
 *   marcados con `cuentaParaObjetivos` (tickets 714c76dd y 234c6b0f).
 *
 * PUT  /api/objetivos-venta — fija (o borra, con cantidad 0) un objetivo de un
 *   producto (`articuloId`), de un grupo de productos (`subcategoria` +
 *   `categoria`) o de unidades totales, para un comercial, una sede o un grupo
 *   de objetivos.
 * DELETE /api/objetivos-venta?id=… — quita un objetivo.
 *
 * Quién ve qué: administración toda la empresa, coordinación solo su sede y en
 * modo lectura (`puedeFijarObjetivos`). Un comercial no entra aquí: su progreso
 * lo ve en el paso 2 del cierre (`/api/cierre-turno/progreso`).
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid, filtroSede, puedeFijarObjetivos, puedeVerObjetivos } from "@/lib/cierre-turno/core";
import {
  ambitoDe,
  anotarVentas,
  columnaSubgrupo,
  COLUMNA_TOTAL,
  construirMatriz,
  cuentaParaObjetivos,
  etiquetaSubgrupo,
  normalizarCantidadObjetivo,
  normalizarMes,
  objetivoDeCoordinacion,
  subgrupoDeObjetivo,
  subgruposDelCatalogo,
  sujetoDeObjetivo,
  totalesMatriz,
  vendidoDeSujeto,
  type AmbitoObjetivo,
  type GrupoObjetivoResumen,
} from "@/lib/cierre-turno/objetivos";
import { describeMiembrosGrupo, gruposVisiblesPara } from "@/lib/cierre-turno/grupos-objetivo";
import { normalizarCategoriaArticulo } from "@/lib/cierre-turno/catalogo";
import {
  preciosActivos as leerPreciosActivos,
  ventasAgregadas,
} from "@/lib/cierre-turno/ventas-queries";
import { sedesDelUsuario } from "@/lib/tiendas/sedes-usuario";

/** Consecución con la misma regla que el resto del módulo (sin objetivo, null). */
function pct(vendido: number, objetivo: number | null): number | null {
  if (objetivo === null || objetivo <= 0) return null;
  return Math.round((vendido / objetivo) * 1000) / 10;
}

interface Sesion {
  userId: string;
  rol: string;
  tiendaId: string | null;
}

async function sesion(): Promise<Sesion | null> {
  const session = await auth();
  if (!session?.user) return null;
  return {
    userId: session.user.id!,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rol: (session.user as any).rol as string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tiendaId: ((session.user as any).tiendaId as string | null) ?? null,
  };
}

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const s = await sesion();
    if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (!puedeVerObjetivos(s.rol)) {
      return NextResponse.json(
        { error: "Los objetivos de venta los consultan administración y coordinación." },
        { status: 403 },
      );
    }

    const url = new URL(req.url);
    const mesPedido = url.searchParams.get("mes") ?? diaMadrid().slice(0, 7);
    const mesOk = normalizarMes(mesPedido);
    if (!mesOk.ok) return NextResponse.json({ error: mesOk.error }, { status: 400 });
    const mes = mesOk.mes;

    // El coordinador va atado a las sedes que lleva, aunque pida otra. Sin
    // ninguna asignada no ve todas: no ve ninguna (ver `filtroSede`).
    const sedesPropias =
      s.rol === "OWNER" ? [] : await sedesDelUsuario(prisma, { userId: s.userId, tiendaId: s.tiendaId });
    const filtro = filtroSede(s.rol, sedesPropias, url.searchParams.get("tiendaId"));
    if (filtro.tipo === "ninguna") {
      return NextResponse.json({
        mes,
        soloLectura: true,
        preciosActivos: false,
        articulos: [],
        subgrupos: [],
        excluidos: [],
        filasComerciales: [],
        filasSedes: [],
        filasGrupos: [],
        totalesComerciales: {},
        totalesSedes: {},
        totalesGrupos: {},
        objetivosDelMes: [],
        resumen: { objetivo: 0, vendido: 0, conObjetivo: 0 },
        sinSede: true,
      });
    }
    // Sedes del alcance: todas (administración) o las del coordinador.
    const sedesFiltro = filtro.tipo === "sedes" ? filtro.tiendaIds : null;

    const [objetivos, ventasBrutas, articulos, sedes, personas, gruposBrutos, preciosOn] = await Promise.all([
      prisma.objetivoVenta.findMany({
        where: { mes },
        select: {
          id: true,
          mes: true,
          userId: true,
          tiendaId: true,
          grupoId: true,
          articuloId: true,
          categoria: true,
          subcategoria: true,
          cantidad: true,
        },
      }),
      ventasAgregadas(prisma, { mes, tiendaIds: sedesFiltro }),
      prisma.articuloVenta.findMany({
        where: { activo: true },
        select: {
          id: true,
          nombre: true,
          categoria: true,
          subcategoria: true,
          precio: true,
          cuentaParaObjetivos: true,
        },
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      }),
      prisma.tienda.findMany({
        where: { activa: true, ...(sedesFiltro ? { id: { in: sedesFiltro } } : {}) },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" },
      }),
      prisma.user.findMany({
        // El equipo de una coordinadora son las personas de sus sedes, ya sea
        // como sede principal de la ficha o por asignación N:N.
        where: {
          activo: true,
          ...(sedesFiltro
            ? {
                OR: [
                  { tiendaId: { in: sedesFiltro } },
                  { sedes: { some: { tiendaId: { in: sedesFiltro } } } },
                ],
              }
            : {}),
        },
        select: { id: true, nombre: true, apellidos: true, tiendaId: true },
        orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
      }),
      // Grupos de objetivos con sus miembros. Se leen todos y el recorte por
      // alcance lo hace `gruposVisiblesPara`: necesita la composición entera
      // para saber si un grupo cae dentro de las sedes de quien mira.
      prisma.grupoObjetivo.findMany({
        where: { activo: true },
        select: {
          id: true,
          nombre: true,
          miembros: { select: { userId: true, tiendaId: true } },
        },
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      }),
      leerPreciosActivos(prisma),
    ]);

    const precios = new Map(articulos.map((a) => [a.id, a.precio === null ? null : Number(a.precio)]));
    const nombreSede = new Map(sedes.map((t) => [t.id, t.nombre]));

    // Las columnas de la parrilla son los productos que cuentan para objetivos y
    // los grupos que forman. Los excluidos se siguen vendiendo y se siguen
    // viendo en el cierre; aquí solo se dice quién los ha dejado fuera.
    const paraObjetivos = articulos.filter((a) => cuentaParaObjetivos(a));
    const articuloIds = paraObjetivos.map((a) => a.id);
    const subgrupos = subgruposDelCatalogo(paraObjetivos);
    // Grupos de objetivos que puede ver quien mira: administración todos, y
    // coordinación solo los que caen enteros dentro de sus sedes (si no, la
    // consecución saldría recortada y sería mentira).
    const grupos: GrupoObjetivoResumen[] = gruposVisiblesPara(gruposBrutos, {
      tiendaIds: sedesFiltro,
      userIds: personas.map((p) => p.id),
    });
    // Las ventas se anotan con el catálogo COMPLETO: es lo que permite saber
    // que una venta es de un producto excluido y no sumarla en el total. Los
    // grupos marcan en qué agrupación cae cada venta (una sola vez por grupo).
    const ventas = anotarVentas(ventasBrutas, articulos, grupos);

    // Dos matrices independientes: los objetivos personales y los de la sede son
    // objetivos distintos y no se suman entre sí.
    const filasComerciales = construirMatriz(
      "comercial",
      personas.map((p) => ({
        id: p.id,
        nombre: `${p.nombre} ${p.apellidos}`.trim(),
        sede: p.tiendaId ? (nombreSede.get(p.tiendaId) ?? null) : null,
      })),
      articuloIds,
      objetivos,
      ventas,
      paraObjetivos,
    );
    const filasSedes = construirMatriz(
      "sede",
      sedes.map((t) => ({ id: t.id, nombre: t.nombre })),
      articuloIds,
      objetivos,
      ventas,
      paraObjetivos,
    );
    // Tercera tabla: los grupos de objetivos del cliente (TMT, televenta…). El
    // subtítulo de cada fila dice de qué está hecho el grupo, que es lo que
    // permite entender su cifra sin abrir la ficha.
    const filasGrupos = construirMatriz(
      "grupo",
      grupos.map((g) => ({ id: g.id, nombre: g.nombre, sede: describeMiembrosGrupo(g) })),
      articuloIds,
      objetivos,
      ventas,
      paraObjetivos,
    );

    // Vista de todos los objetivos del mes, para revisarlos y borrarlos sin ir
    // artículo por artículo.
    const nombrePersona = new Map(personas.map((p) => [p.id, `${p.nombre} ${p.apellidos}`.trim()]));
    const nombreArticulo = new Map(articulos.map((a) => [a.id, a.nombre]));
    const nombreGrupo = new Map(grupos.map((g) => [g.id, g.nombre]));
    const todos = objetivos
      .map((o) => {
        const amb = ambitoDe(o);
        if (!amb) return null;
        const sujetoId = sujetoDeObjetivo(o);
        const nombre =
          amb === "comercial"
            ? nombrePersona.get(sujetoId)
            : amb === "sede"
              ? nombreSede.get(sujetoId)
              : nombreGrupo.get(sujetoId);
        // Un objetivo de alguien que ya no está (o de otra sede, para el
        // coordinador) no se pinta: no es suyo ni puede hacer nada con él.
        if (!nombre) return null;
        const grupoProductos = subgrupoDeObjetivo(o);
        const vendido = vendidoDeSujeto(
          ventas,
          { ambito: amb, id: sujetoId },
          o.articuloId,
          grupoProductos,
        );
        // Importe solo si el cliente trabaja con precios Y el objetivo es de un
        // artículo concreto con precio: sumar euros de artículos distintos con
        // precios a medio poner daría un total que nadie podría cuadrar.
        const precio = o.articuloId ? (precios.get(o.articuloId) ?? null) : null;
        return {
          id: o.id,
          ambito: amb,
          sujeto: nombre,
          articulo: o.articuloId ? (nombreArticulo.get(o.articuloId) ?? "Artículo retirado") : null,
          grupo: grupoProductos ? etiquetaSubgrupo(grupoProductos) : null,
          objetivo: o.cantidad,
          vendido,
          consecucion: pct(vendido, o.cantidad),
          importe: preciosOn && precio !== null ? Math.round(vendido * precio * 100) / 100 : null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort(
        (a, b) =>
          a.sujeto.localeCompare(b.sujeto, "es") ||
          (a.grupo ?? "").localeCompare(b.grupo ?? "", "es") ||
          (a.articulo ?? "").localeCompare(b.articulo ?? "", "es"),
      );

    const totalesComerciales = totalesMatriz(filasComerciales, articuloIds, subgrupos);
    const totalesSedes = totalesMatriz(filasSedes, articuloIds, subgrupos);
    const totalesGrupos = totalesMatriz(filasGrupos, articuloIds, subgrupos);
    // Objetivo propio de la coordinadora: el de su zona (ticket 73). Solo tiene
    // sentido con alcance limitado a sus sedes; para administración, la cifra
    // equivalente ya es el pie de la tabla de sedes.
    const esCoordinacion = filtro.tipo === "sedes" && s.rol !== "OWNER";

    return NextResponse.json({
      mes,
      soloLectura: !puedeFijarObjetivos(s.rol),
      preciosActivos: preciosOn,
      // Solo los productos que cuentan: son las columnas que se pueden fijar.
      articulos: paraObjetivos.map((a) => ({
        id: a.id,
        nombre: a.nombre,
        categoria: a.categoria,
        subcategoria: a.subcategoria,
        precio: a.precio === null ? null : Number(a.precio),
      })),
      // Los grupos de productos sobre los que se puede fijar objetivo: cada
      // subcategoría del catálogo, con su columna ya resuelta para que la
      // pantalla no tenga que componerla.
      subgrupos: subgrupos.map((g) => ({
        id: columnaSubgrupo(g),
        categoria: g.categoria,
        subcategoria: g.subcategoria,
        etiqueta: etiquetaSubgrupo(g),
      })),
      // Los que administración ha dejado fuera, para poder decirlo en pantalla
      // en vez de que parezca que se han perdido del catálogo.
      excluidos: articulos.filter((a) => !cuentaParaObjetivos(a)).map((a) => a.nombre),
      filasComerciales,
      filasSedes,
      filasGrupos,
      totalesComerciales,
      totalesSedes,
      totalesGrupos,
      objetivosDelMes: todos,
      objetivoPropio: esCoordinacion
        ? objetivoDeCoordinacion({ filasSedes, filasComerciales })
        : null,
      // Las tarjetas de arriba miden el objetivo de unidades totales de los
      // comerciales: el fijado a mano o, donde no lo haya, la suma de sus
      // objetivos por producto (`objetivoTotalDe`). Lo de cada producto y lo de
      // cada sede se lee en el pie de su tabla, que es donde tiene sentido.
      resumen: {
        objetivo: totalesComerciales[COLUMNA_TOTAL]?.objetivo ?? 0,
        vendido: totalesComerciales[COLUMNA_TOTAL]?.vendido ?? 0,
        conObjetivo: totalesComerciales[COLUMNA_TOTAL]?.conObjetivo ?? 0,
      },
    });
  }),
);

export const PUT = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const s = await sesion();
    if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (!puedeFijarObjetivos(s.rol)) {
      return NextResponse.json(
        { error: "Solo un administrador puede fijar objetivos de venta." },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => null)) as {
      mes?: unknown;
      ambito?: unknown;
      sujetoId?: unknown;
      articuloId?: unknown;
      subcategoria?: unknown;
      categoria?: unknown;
      cantidad?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

    const mesOk = normalizarMes(body.mes);
    if (!mesOk.ok) return NextResponse.json({ error: mesOk.error }, { status: 400 });
    const cantidadOk = normalizarCantidadObjetivo(body.cantidad);
    if (!cantidadOk.ok) return NextResponse.json({ error: cantidadOk.error }, { status: 400 });

    const ambito: AmbitoObjetivo =
      body.ambito === "sede" ? "sede" : body.ambito === "grupo" ? "grupo" : "comercial";
    if (typeof body.sujetoId !== "string" || !body.sujetoId) {
      return NextResponse.json({ error: "Falta a quién es el objetivo." }, { status: 400 });
    }
    const articuloId = typeof body.articuloId === "string" && body.articuloId ? body.articuloId : null;
    // Grupo de productos: la subcategoría del catálogo, tal cual se guardó
    // allí, con la categoría de la que cuelga (la misma subcategoría puede
    // colgar de dos categorías y son dos grupos distintos).
    const subcategoria = normalizarCategoriaArticulo(body.subcategoria);
    const categoria = normalizarCategoriaArticulo(body.categoria);
    if (articuloId && subcategoria) {
      return NextResponse.json(
        { error: "Un objetivo es de un producto o de un grupo, no de los dos." },
        { status: 400 },
      );
    }
    // La categoría por sí sola ya no es un grupo con objetivo: es organización
    // del catálogo y dato de informes (ticket 234c6b0f). Se dice en vez de
    // guardar una fila que no mediría nada.
    if (categoria && !subcategoria) {
      return NextResponse.json(
        {
          error:
            "Los objetivos de grupo se fijan sobre una subcategoría, no sobre la categoría entera.",
        },
        { status: 400 },
      );
    }

    // Comprobar que el destinatario y el artículo existen: un objetivo de un id
    // inventado no se vería en ninguna pantalla y quedaría de basura en la tabla.
    if (ambito === "comercial") {
      const existe = await prisma.user.findUnique({ where: { id: body.sujetoId }, select: { id: true } });
      if (!existe) return NextResponse.json({ error: "Ese empleado no existe." }, { status: 404 });
    } else if (ambito === "sede") {
      const existe = await prisma.tienda.findUnique({ where: { id: body.sujetoId }, select: { id: true } });
      if (!existe) return NextResponse.json({ error: "Esa sede no existe." }, { status: 404 });
    } else {
      const existe = await prisma.grupoObjetivo.findUnique({
        where: { id: body.sujetoId },
        select: { id: true, activo: true },
      });
      if (!existe) return NextResponse.json({ error: "Ese grupo no existe." }, { status: 404 });
      // Un grupo desactivado no se pinta en ninguna parrilla: dejar fijarle
      // objetivos sería guardar cifras que nadie va a volver a ver.
      if (!existe.activo) {
        return NextResponse.json(
          { error: "Ese grupo está desactivado. Actívalo para fijarle objetivos." },
          { status: 400 },
        );
      }
    }
    if (articuloId) {
      const existe = await prisma.articuloVenta.findUnique({
        where: { id: articuloId },
        select: { id: true, nombre: true, cuentaParaObjetivos: true },
      });
      if (!existe) return NextResponse.json({ error: "Ese artículo no existe." }, { status: 404 });
      // Un objetivo sobre un producto que el propio cliente ha dejado fuera de
      // los objetivos no se podría cumplir de forma coherente con el resto de
      // cifras: mejor decirlo que guardarlo y que no cuadre.
      if (!existe.cuentaParaObjetivos) {
        return NextResponse.json(
          {
            error: `"${existe.nombre}" está marcado como que no cuenta para los objetivos. Cámbialo en Configuración → Catálogo de ventas.`,
          },
          { status: 400 },
        );
      }
    }
    if (subcategoria) {
      // El grupo tiene que existir en el catálogo activo y tener algún producto
      // que cuente: si no, sería un objetivo que nadie puede cumplir.
      const hay = await prisma.articuloVenta.findFirst({
        where: { activo: true, categoria, subcategoria, cuentaParaObjetivos: true },
        select: { id: true },
      });
      if (!hay) {
        return NextResponse.json(
          { error: "Ese grupo de productos no existe en el catálogo." },
          { status: 404 },
        );
      }
    }

    const donde = {
      mes: mesOk.mes,
      userId: ambito === "comercial" ? body.sujetoId : null,
      tiendaId: ambito === "sede" ? body.sujetoId : null,
      // Los tres destinatarios van explícitos (con null incluido): sin
      // `grupoId: null`, el `findFirst` de un objetivo de comercial también
      // casaría con el del grupo que tuviera el mismo mes y producto.
      grupoId: ambito === "grupo" ? body.sujetoId : null,
      articuloId,
      categoria,
      subcategoria,
    };

    // No se usa `upsert` sobre la clave única (mes, userId, tiendaId,
    // articuloId): en Postgres dos NULL no son iguales, así que la unique no
    // dedupe las combinaciones con hueco y el upsert crearía duplicados. Con
    // findFirst + update/create dentro de una transacción sí queda una sola
    // fila por combinación.
    const resultado = await prisma.$transaction(async (tx) => {
      const previo = await tx.objetivoVenta.findFirst({ where: donde, select: { id: true } });

      if (cantidadOk.cantidad === 0) {
        if (previo) await tx.objetivoVenta.delete({ where: { id: previo.id } });
        return { borrado: true as const };
      }
      if (previo) {
        const act = await tx.objetivoVenta.update({
          where: { id: previo.id },
          data: { cantidad: cantidadOk.cantidad },
          select: { id: true, cantidad: true },
        });
        return { borrado: false as const, ...act };
      }
      const nuevo = await tx.objetivoVenta.create({
        data: { ...donde, cantidad: cantidadOk.cantidad },
        select: { id: true, cantidad: true },
      });
      return { borrado: false as const, ...nuevo };
    });

    return NextResponse.json(resultado);
  }),
);

export const DELETE = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const s = await sesion();
    if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (!puedeFijarObjetivos(s.rol)) {
      return NextResponse.json(
        { error: "Solo un administrador puede quitar objetivos de venta." },
        { status: 403 },
      );
    }
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Falta el objetivo." }, { status: 400 });

    const previo = await prisma.objetivoVenta.findUnique({ where: { id }, select: { id: true } });
    if (!previo) return NextResponse.json({ error: "Ese objetivo ya no existe." }, { status: 404 });
    await prisma.objetivoVenta.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }),
);
