/**
 * Seguimiento diario de los objetivos de venta (módulo "Cierre de turno",
 * plan Enterprise).
 *
 * GET /api/objetivos-venta/seguimiento
 *   ?mes=YYYY-MM        mes del objetivo (por omisión, el que corre)
 *   ?hasta=YYYY-MM-DD   día de corte: hasta dónde se cuenta (por omisión hoy,
 *                       o el último día si el mes ya está cerrado)
 *   ?tiendaId=…         un punto de venta
 *   ?userId=…           un comercial
 *   ?concepto=          qué se sigue: "" (unidades totales), "cat:<grupo>" o
 *                       el id de un artículo
 *
 * Devuelve, con esos filtros: una fila por comercial y otra tanda por sede con
 * objetivo, vendido, lo que tocaría llevar a día de hoy, desviación, ritmo
 * necesario y previsión de cierre; y el día a día del mes hasta el corte.
 *
 * Es la mitad de "seguimiento" del área de objetivos de venta: la de
 * "definición" (fijar los objetivos del mes) sigue en `/api/objetivos-venta`.
 * Se calcula aquí y no en el otro endpoint porque son dos preguntas distintas
 * —"qué pedimos este mes" y "cómo vamos hoy"— y la segunda necesita las ventas
 * sin colapsar el día.
 *
 * Quién ve qué: lo mismo que la definición. Administración toda la empresa,
 * coordinación solo las sedes que lleva (`filtroSede`), y un comercial no
 * entra: su progreso lo ve en el paso 2 de su cierre.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid, filtroSede, puedeVerObjetivos } from "@/lib/cierre-turno/core";
import {
  anotarVentas,
  categoriasDelCatalogo,
  columnaCategoria,
  cuentaParaObjetivos,
  normalizarMes,
} from "@/lib/cierre-turno/objetivos";
import {
  construirSeguimiento,
  normalizarConcepto,
  normalizarDiaCorte,
  progresoDelMes,
  serieDiaria,
  totalesSeguimiento,
} from "@/lib/cierre-turno/seguimiento";
import { ventasPorDia } from "@/lib/cierre-turno/ventas-queries";
import { sedesDelUsuario } from "@/lib/tiendas/sedes-usuario";

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaPropia = ((session.user as any).tiendaId as string | null) ?? null;
    if (!puedeVerObjetivos(rol)) {
      return NextResponse.json(
        { error: "El seguimiento de objetivos lo consultan administración y coordinación." },
        { status: 403 },
      );
    }

    const url = new URL(req.url);
    const hoy = diaMadrid();
    const mesOk = normalizarMes(url.searchParams.get("mes") ?? hoy.slice(0, 7));
    if (!mesOk.ok) return NextResponse.json({ error: mesOk.error }, { status: 400 });
    const mes = mesOk.mes;
    const corte = normalizarDiaCorte(mes, url.searchParams.get("hasta"), hoy);
    const progreso = progresoDelMes(mes, corte, hoy);
    // Ventana de lectura: del día 1 al de corte, ambos incluidos. Internamente
    // se usa `[desde, hasta)`, como en el informe de ventas.
    const desde = new Date(`${mes}-01T00:00:00Z`);
    const hasta = new Date(new Date(`${corte}T00:00:00Z`).getTime() + 86_400_000);

    // El coordinador va atado a las sedes que lleva, aunque pida otra. Sin
    // ninguna asignada no ve todas: no ve ninguna (ver `filtroSede`).
    const sedesPropias =
      rol === "OWNER" ? [] : await sedesDelUsuario(prisma, { userId: session.user.id!, tiendaId: tiendaPropia });
    const filtro = filtroSede(rol, sedesPropias, url.searchParams.get("tiendaId"));
    if (filtro.tipo === "ninguna") {
      return NextResponse.json({
        mes,
        corte,
        dias: progreso.dias,
        transcurridos: progreso.transcurridos,
        restantes: progreso.restantes,
        concepto: { id: "", tipo: "total", etiqueta: "Unidades totales" },
        conceptos: [],
        sedes: [],
        comerciales: [],
        filasComerciales: [],
        filasSedes: [],
        totalesComerciales: null,
        totalesSedes: null,
        serie: [],
        objetivoSerie: null,
        sinSede: true,
      });
    }
    const sedesFiltro = filtro.tipo === "sedes" ? filtro.tiendaIds : null;

    const [objetivos, ventasBrutas, articulos, sedes, personas] = await Promise.all([
      prisma.objetivoVenta.findMany({
        where: { mes },
        select: {
          id: true,
          mes: true,
          userId: true,
          tiendaId: true,
          articuloId: true,
          categoria: true,
          cantidad: true,
        },
      }),
      // Solo hasta el día de corte: mirar "cómo íbamos el día 10" no puede
      // contar lo que se vendió el 11. Y con el alcance de sede, no con el del
      // comercial: la tabla de sedes tiene que seguir enseñando la sede entera
      // aunque se esté mirando a una persona (el filtro se aplica después).
      ventasPorDia(prisma, { desde, hasta, tiendaIds: sedesFiltro }),
      prisma.articuloVenta.findMany({
        where: { activo: true },
        select: { id: true, nombre: true, categoria: true, cuentaParaObjetivos: true },
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
    ]);

    const paraObjetivos = articulos.filter((a) => cuentaParaObjetivos(a));
    const articuloIds = paraObjetivos.map((a) => a.id);
    const categorias = categoriasDelCatalogo(paraObjetivos);
    const concepto = normalizarConcepto(url.searchParams.get("concepto"), paraObjetivos, categorias);
    // Las ventas se anotan con el catálogo COMPLETO: es lo que permite saber
    // que una venta es de un producto excluido y no sumarla en el total.
    const ventas = anotarVentas(ventasBrutas, articulos);

    const nombreSede = new Map(sedes.map((t) => [t.id, t.nombre]));
    // Un comercial que no está en el alcance no acota nada: se ignora, igual
    // que una sede ajena en `filtroSede`.
    const userPedido = url.searchParams.get("userId");
    const userId = userPedido && personas.some((p) => p.id === userPedido) ? userPedido : null;
    const personasFiltradas = userId ? personas.filter((p) => p.id === userId) : personas;
    const ventasComerciales = userId ? ventas.filter((v) => v.userId === userId) : ventas;

    const filasComerciales = construirSeguimiento({
      ambito: "comercial",
      sujetos: personasFiltradas.map((p) => ({
        id: p.id,
        nombre: `${p.nombre} ${p.apellidos}`.trim(),
        sede: p.tiendaId ? (nombreSede.get(p.tiendaId) ?? null) : null,
      })),
      objetivos,
      ventas: ventasComerciales,
      concepto,
      progreso,
      articuloIds,
      catalogo: paraObjetivos,
    });
    const filasSedes = construirSeguimiento({
      ambito: "sede",
      sujetos: sedes.map((t) => ({ id: t.id, nombre: t.nombre })),
      objetivos,
      ventas,
      concepto,
      progreso,
      articuloIds,
      catalogo: paraObjetivos,
    });

    const totalesComerciales = totalesSeguimiento(filasComerciales, progreso);
    const totalesSedes = totalesSeguimiento(filasSedes, progreso);

    // El día a día se mide contra el objetivo de lo que se está mirando: el del
    // comercial elegido si hay uno, y si no el de las sedes del alcance (que es
    // el objetivo de la zona o de la empresa, según quién mire).
    const objetivoSerie = userId ? (filasComerciales[0]?.objetivo ?? null) : totalesSedes.objetivo;
    const serie = serieDiaria({ ventas: ventasComerciales, concepto, objetivo: objetivoSerie, progreso });

    return NextResponse.json({
      mes,
      corte,
      dias: progreso.dias,
      transcurridos: progreso.transcurridos,
      restantes: progreso.restantes,
      concepto: { id: concepto.id, tipo: concepto.tipo, etiqueta: concepto.etiqueta },
      // Lo que se puede seguir: unidades totales, cada grupo y cada producto
      // que cuenta para objetivos (los excluidos no tienen objetivo posible).
      conceptos: [
        { id: "", tipo: "total" as const, etiqueta: "Unidades totales" },
        ...categorias.map((c) => ({
          id: columnaCategoria(c),
          tipo: "grupo" as const,
          etiqueta: c,
        })),
        ...paraObjetivos.map((a) => ({ id: a.id, tipo: "articulo" as const, etiqueta: a.nombre })),
      ],
      sedes,
      comerciales: personas.map((p) => ({
        id: p.id,
        nombre: `${p.nombre} ${p.apellidos}`.trim(),
        tiendaId: p.tiendaId,
      })),
      filtros: { tiendaId: sedesFiltro?.length === 1 ? sedesFiltro[0] : null, userId },
      filasComerciales,
      filasSedes,
      totalesComerciales,
      totalesSedes,
      serie,
      objetivoSerie,
    });
  }),
);
