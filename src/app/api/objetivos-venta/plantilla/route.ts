/**
 * GET /api/objetivos-venta/plantilla?mes=YYYY-MM
 *
 * Descarga la plantilla Excel de objetivos del mes: una fila por comercial, por
 * punto de venta y por grupo de objetivos (TMT, televenta…), y una columna por
 * unidades totales, por grupo de productos y por artículo del catálogo, ya
 * rellena con los objetivos que hay fijados. Se edita en Excel y se vuelve a
 * subir por `/api/objetivos-venta/importar`.
 *
 * Mismo alcance que la parrilla (`/api/objetivos-venta`): administración toda
 * la empresa y coordinación solo sus sedes. Coordinación puede descargarla —le
 * sirve como exportación de lo fijado—, pero no subirla: eso lo comprueba el
 * importador.
 *
 * Datos con `prismaApp` y envuelto en `withTenant`; nada de fetch interno entre
 * rutas (AGENTS.md): la hoja se arma aquí con las funciones de
 * `@/lib/cierre-turno/objetivos-plantilla`.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { diaMadrid, filtroSede, puedeVerObjetivos } from "@/lib/cierre-turno/core";
import { normalizarMes } from "@/lib/cierre-turno/objetivos";
import {
  columnasPlantilla,
  filasPlantilla,
  type SujetoPlantilla,
} from "@/lib/cierre-turno/objetivos-plantilla";
import { generarPlantillaObjetivos } from "@/lib/cierre-turno/objetivos-excel";
import { gruposVisiblesPara } from "@/lib/cierre-turno/grupos-objetivo";
import { sedesDelUsuario } from "@/lib/tiendas/sedes-usuario";

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    if (!puedeVerObjetivos(rol)) {
      return NextResponse.json(
        { error: "Los objetivos de venta los consultan administración y coordinación." },
        { status: 403 },
      );
    }

    const url = new URL(req.url);
    const mesOk = normalizarMes(url.searchParams.get("mes") ?? diaMadrid().slice(0, 7));
    if (!mesOk.ok) return NextResponse.json({ error: mesOk.error }, { status: 400 });
    const mes = mesOk.mes;

    const userId = session.user.id as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaId = ((session.user as any).tiendaId as string | null) ?? null;
    const sedesPropias = rol === "OWNER" ? [] : await sedesDelUsuario(prisma, { userId, tiendaId });
    const filtro = filtroSede(rol, sedesPropias, url.searchParams.get("tiendaId"));
    if (filtro.tipo === "ninguna") {
      return NextResponse.json(
        { error: "No tienes ninguna sede asignada, así que no hay objetivos que descargar." },
        { status: 400 },
      );
    }
    const sedesFiltro = filtro.tipo === "sedes" ? filtro.tiendaIds : null;

    const [objetivos, articulos, sedes, personas, gruposBrutos] = await Promise.all([
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
          fuente: true,
          cantidad: true,
        },
      }),
      prisma.articuloVenta.findMany({
        where: { activo: true },
        // La subcategoría es el grupo sobre el que se fijan los objetivos y
        // además titula la columna de dos artículos que se llamen igual.
        select: {
          id: true,
          nombre: true,
          categoria: true,
          subcategoria: true,
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
        select: { id: true, nombre: true, apellidos: true },
        orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
      }),
      // Grupos de objetivos, con sus miembros para poder recortar por alcance.
      prisma.grupoObjetivo.findMany({
        where: { activo: true },
        select: {
          id: true,
          nombre: true,
          miembros: { select: { userId: true, tiendaId: true } },
        },
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
      }),
    ]);

    // Mismo recorte que la parrilla: coordinación solo baja los grupos que caen
    // enteros dentro de sus sedes (ver `gruposVisiblesPara`).
    const grupos = gruposVisiblesPara(gruposBrutos, {
      tiendaIds: sedesFiltro,
      userIds: personas.map((p) => p.id),
    });

    const columnas = columnasPlantilla(articulos);
    const sujetos: SujetoPlantilla[] = [
      ...personas.map((p) => ({
        ambito: "comercial" as const,
        id: p.id,
        nombre: `${p.nombre} ${p.apellidos}`.trim(),
      })),
      ...sedes.map((t) => ({ ambito: "sede" as const, id: t.id, nombre: t.nombre })),
      // Cada punto de venta baja una segunda vez con el objetivo que le impone
      // el operador (ticket 5d8b21c7): mismas columnas, otra cifra. Van juntas
      // al final para que se vea de un golpe la vara del operador.
      ...sedes.map((t) => ({
        ambito: "sede" as const,
        id: t.id,
        nombre: t.nombre,
        fuente: "tmt" as const,
      })),
      ...grupos.map((g) => ({ ambito: "grupo" as const, id: g.id, nombre: g.nombre })),
    ];

    const buf = await generarPlantillaObjetivos({
      mes,
      columnas,
      filas: filasPlantilla(sujetos, columnas, objetivos),
    });

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="objetivos_venta_${mes}.xlsx"`,
        "Content-Length": String(buf.length),
      },
    });
  }),
);
