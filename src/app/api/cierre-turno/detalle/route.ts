/**
 * GET /api/cierre-turno/detalle?id=… — todo lo de un cierre concreto: ventas,
 * caja, adjuntos y el rastro de correcciones.
 *
 * Es la pantalla que necesita administración cuando algo no cuadra: ver qué
 * declaró la persona, abrir el Excel del stock o el comprobante del datáfono y,
 * si procede, corregir la caja (eso lo hace `PATCH /api/cierre-turno/caja`).
 *
 * Alcance en la propia consulta y no después: con un id ajeno la consulta no
 * devuelve nada, en vez de devolverlo y filtrar luego.
 *
 * No va en `/api/cierre-turno/[id]` para no competir con las subrutas fijas
 * (`/caja`, `/hoy`, `/confirmar`, `/adjuntos`, `/progreso`) del mismo prefijo.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { alcanceSegunRol, puedeEditarCaja } from "@/lib/cierre-turno/core";
import { sedesDelUsuario } from "@/lib/tiendas/sedes-usuario";

export const GET = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiendaPropia = ((session.user as any).tiendaId as string | null) ?? null;

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Falta el cierre." }, { status: 400 });

    const alcance = alcanceSegunRol(rol);
    const sedesPropias =
      alcance === "sede"
        ? await sedesDelUsuario(prisma, { userId: session.user.id!, tiendaId: tiendaPropia })
        : [];
    const cierre = await prisma.cierreTurno.findFirst({
      where: {
        id,
        ...(alcance === "propio"
          ? { userId }
          : alcance === "sede"
            ? { tiendaId: { in: sedesPropias } }
            : {}),
      },
      select: {
        id: true,
        fecha: true,
        estado: true,
        detalleJornada: true,
        incidencia: true,
        completadoEn: true,
        user: { select: { id: true, nombre: true, apellidos: true, email: true } },
        tienda: { select: { id: true, nombre: true } },
        ventas: {
          select: { id: true, nombreArticulo: true, cantidad: true, articuloId: true },
          orderBy: { nombreArticulo: "asc" },
        },
        caja: {
          select: {
            id: true,
            efectivo: true,
            tarjeta: true,
            confirmadoEn: true,
            adjuntos: {
              select: { id: true, tipo: true, nombre: true, mime: true, tamañoBytes: true, createdAt: true },
              orderBy: { createdAt: "asc" },
            },
            ediciones: {
              select: {
                id: true,
                campo: true,
                valorAntes: true,
                valorDespues: true,
                motivo: true,
                createdAt: true,
                admin: { select: { nombre: true, apellidos: true } },
              },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });
    if (!cierre) return NextResponse.json({ error: "Cierre no encontrado" }, { status: 404 });

    // Precios del catálogo para poder poner un importe al lado de las unidades,
    // si el cliente trabaja con precios.
    const [cfg, articulos] = await Promise.all([
      prisma.configuracionEmpresa.findUnique({
        where: { id: "singleton" },
        select: { ventasPreciosActivos: true },
      }),
      cierre.ventas.length > 0
        ? prisma.articuloVenta.findMany({
            where: { id: { in: cierre.ventas.map((v) => v.articuloId).filter((x): x is string => !!x) } },
            select: { id: true, precio: true },
          })
        : Promise.resolve([]),
    ]);
    const preciosOn = cfg?.ventasPreciosActivos ?? false;
    const precio = new Map(articulos.map((a) => [a.id, a.precio === null ? null : Number(a.precio)]));

    const ventas = cierre.ventas.map((v) => {
      const p = v.articuloId ? (precio.get(v.articuloId) ?? null) : null;
      return {
        id: v.id,
        nombre: v.nombreArticulo,
        cantidad: v.cantidad,
        precio: preciosOn ? p : null,
        importe: preciosOn && p !== null ? Math.round(v.cantidad * p * 100) / 100 : null,
      };
    });

    return NextResponse.json({
      id: cierre.id,
      fecha: cierre.fecha.toISOString().slice(0, 10),
      estado: cierre.estado,
      detalleJornada: cierre.detalleJornada,
      incidencia: cierre.incidencia,
      completado: Boolean(cierre.completadoEn),
      completadoEn: cierre.completadoEn?.toISOString() ?? null,
      empleado: {
        id: cierre.user.id,
        nombre: `${cierre.user.nombre} ${cierre.user.apellidos}`.trim(),
        email: cierre.user.email,
      },
      sede: cierre.tienda,
      preciosActivos: preciosOn,
      ventas,
      unidades: ventas.reduce((n, v) => n + v.cantidad, 0),
      importeVendido: preciosOn ? ventas.reduce((n, v) => n + (v.importe ?? 0), 0) : null,
      caja: cierre.caja
        ? {
            id: cierre.caja.id,
            efectivo: Number(cierre.caja.efectivo),
            tarjeta: Number(cierre.caja.tarjeta),
            confirmado: Boolean(cierre.caja.confirmadoEn),
            confirmadoEn: cierre.caja.confirmadoEn?.toISOString() ?? null,
            adjuntos: cierre.caja.adjuntos.map((a) => ({
              id: a.id,
              tipo: a.tipo,
              nombre: a.nombre,
              mime: a.mime,
              tamañoBytes: a.tamañoBytes,
              subidoEn: a.createdAt.toISOString(),
            })),
            ediciones: cierre.caja.ediciones.map((e) => ({
              id: e.id,
              campo: e.campo,
              valorAntes: Number(e.valorAntes),
              valorDespues: Number(e.valorDespues),
              motivo: e.motivo,
              cuando: e.createdAt.toISOString(),
              admin: `${e.admin.nombre} ${e.admin.apellidos}`.trim(),
            })),
          }
        : null,
      // Se dice desde el servidor si quien mira puede corregir: la pantalla no
      // tiene que deducir permisos por su cuenta.
      puedeCorregir: puedeEditarCaja(
        rol,
        Boolean(cierre.caja?.confirmadoEn),
        cierre.user.id === userId,
      ),
    });
  }),
);
