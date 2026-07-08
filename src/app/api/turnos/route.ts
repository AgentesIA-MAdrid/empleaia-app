import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol, EstadoTurno } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const GET = withTenant(withFeature("turnos_publicacion", async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const tiendaId = searchParams.get("tiendaId");
    const userId = searchParams.get("userId");
    const fechaInicio = searchParams.get("fechaInicio");
    const fechaFin = searchParams.get("fechaFin");
    const estado = searchParams.get("estado") as EstadoTurno | null;

    const userRol = (session.user as any).rol as Rol;
    const userTiendaId = (session.user as any).tiendaId as string | null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (userRol === Rol.OWNER) {
      if (tiendaId) where.tiendaId = tiendaId;
      if (userId) where.userId = userId;
    } else if (userRol === Rol.MANAGER) {
      where.tiendaId = userTiendaId;
      if (userId) where.userId = userId;
    } else {
      // EMPLEADO
      where.userId = session.user.id;
    }

    if (estado && Object.values(EstadoTurno).includes(estado)) {
      where.estado = estado;
    }

    if (fechaInicio || fechaFin) {
      where.fecha = {};
      if (fechaInicio) where.fecha.gte = new Date(fechaInicio);
      if (fechaFin) {
        const fin = new Date(fechaFin);
        fin.setHours(23, 59, 59, 999);
        where.fecha.lte = fin;
      }
    }

    const turnos = await prisma.turno.findMany({
      where,
      include: {
        user: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
        tienda: {
          select: { id: true, nombre: true, color: true },
        },
        tipoTurno: {
          select: {
            id: true,
            nombre: true,
            abreviatura: true,
            color: true,
            horas: true,
            esLibre: true,
          },
        },
      },
      orderBy: { fecha: "asc" },
    });

    return Response.json(turnos);
  } catch (error) {
    console.error("GET /api/turnos error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}));

export const POST = withTenant(withFeature("turnos_publicacion", async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    // Crear turnos es gestión: solo el Administrador (OWNER). El Coordinador
    // (MANAGER) conserva la lectura (GET) de los turnos de su centro.
    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json();
    const {
      userId,
      tiendaId,
      tipoTurnoId,
      fecha,
      horaInicio,
      horaFin,
      nota,
      estado = EstadoTurno.BORRADOR,
    } = body as {
      userId: string;
      tiendaId: string;
      tipoTurnoId?: string | null;
      fecha: string;
      horaInicio?: string;
      horaFin?: string;
      nota?: string;
      estado?: EstadoTurno;
    };

    // Si se indica un tipo de turno, hereda su horario por defecto cuando
    // el body no trae rango propio. Permite crear el turno solo con tipo.
    let inicio = horaInicio;
    let fin = horaFin;
    if (tipoTurnoId) {
      const tipo = await prisma.tipoTurno.findUnique({
        where: { id: tipoTurnoId },
        select: { horaInicio: true, horaFin: true },
      });
      if (!tipo) {
        return Response.json({ error: "tipo_turno_no_existe" }, { status: 400 });
      }
      inicio = inicio || tipo.horaInicio || "";
      fin = fin || tipo.horaFin || "";
    }

    if (!userId || !tiendaId || !fecha) {
      return Response.json(
        { error: "Faltan campos obligatorios: userId, tiendaId, fecha" },
        { status: 400 }
      );
    }
    if (!tipoTurnoId && (!inicio || !fin)) {
      return Response.json(
        { error: "Indica un tipo de turno o un rango horaInicio/horaFin" },
        { status: 400 }
      );
    }

    // Evita duplicar a una persona: un turno idéntico (misma sede, mismo día,
    // mismo tipo y mismo horario) ya asignado se rechaza para que no se repita
    // por error. El cuadrante ya deduplica el arrastre en cliente; esto lo
    // garantiza también para el alta manual y cualquier otra vía.
    const diaInicio = new Date(fecha);
    const diaFin = new Date(diaInicio);
    diaFin.setHours(23, 59, 59, 999);
    const duplicado = await prisma.turno.findFirst({
      where: {
        userId,
        tiendaId,
        tipoTurnoId: tipoTurnoId ?? null,
        horaInicio: inicio ?? "",
        horaFin: fin ?? "",
        fecha: { gte: diaInicio, lte: diaFin },
      },
      select: { id: true },
    });
    if (duplicado) {
      return Response.json(
        { error: "Esta persona ya tiene ese turno ese día" },
        { status: 409 }
      );
    }

    const turno = await prisma.turno.create({
      data: {
        userId,
        tiendaId,
        tipoTurnoId: tipoTurnoId ?? null,
        fecha: new Date(fecha),
        horaInicio: inicio ?? "",
        horaFin: fin ?? "",
        nota,
        estado,
      },
      include: {
        user: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
        tienda: {
          select: { id: true, nombre: true, color: true },
        },
        tipoTurno: {
          select: {
            id: true,
            nombre: true,
            abreviatura: true,
            color: true,
            horas: true,
            esLibre: true,
          },
        },
      },
    });

    return Response.json(turno, { status: 201 });
  } catch (error) {
    console.error("POST /api/turnos error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}));
