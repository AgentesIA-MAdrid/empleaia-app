import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { esPerfilCompleto } from "@/lib/empleados/perfil";

// Campos de texto de la ficha ampliada que cualquiera (self o admin)
// puede editar de su propio perfil. Vacío ("") se normaliza a null.
const CAMPOS_TEXTO_FICHA = [
  "tipoIdentificacion",
  "tipoIdentificacionSecundaria",
  "numeroIdentificacionSecundaria",
  "nacionalidad",
  "estadoCivil",
  "genero",
  "domicilio",
  "codigoPostal",
  "localidad",
  "provincia",
  "pais",
  "emailEmpresa",
  "emailPersonal",
  "emailNotificaciones",
  "telefonoEmpresa",
  "telefonoEmergencia",
  "contactoUrgencia",
  "grupoCotizacion",
  "categoriaProfesional",
  "numeroSeguridadSocial",
  "codigoContrato",
  "titularCuenta",
  "iban",
  "bic",
  "entidadBancaria",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const norm = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const userSelect = {
  id: true,
  email: true,
  nombre: true,
  apellidos: true,
  dni: true,
  telefono: true,
  foto: true,
  fechaNacimiento: true,
  rol: true,
  tiendaId: true,
  tienda: { select: { id: true, nombre: true } },
  activo: true,
  salarioBase: true,
  horasSemanalesContrato: true,
  perfilCompletado: true,
  // Ficha ampliada.
  tipoIdentificacion: true,
  tipoIdentificacionSecundaria: true,
  numeroIdentificacionSecundaria: true,
  nacionalidad: true,
  estadoCivil: true,
  genero: true,
  compartirCumpleanos: true,
  domicilio: true,
  codigoPostal: true,
  localidad: true,
  provincia: true,
  pais: true,
  emailEmpresa: true,
  emailPersonal: true,
  emailNotificaciones: true,
  telefonoEmpresa: true,
  telefonoEmergencia: true,
  contactoUrgencia: true,
  teletrabajo: true,
  grupoCotizacion: true,
  categoriaProfesional: true,
  numeroSeguridadSocial: true,
  codigoContrato: true,
  numeroHijos: true,
  porcentajeDiscapacidad: true,
  titularCuenta: true,
  iban: true,
  bic: true,
  entidadBancaria: true,
  password: true,
  resetToken: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const GET = withTenant(async (_request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const userRol = (session.user as any).rol as Rol;
    const userTiendaId = (session.user as any).tiendaId as string | null;

    // Can access own profile, or OWNER/MANAGER can access others
    if (
      id !== session.user.id &&
      userRol !== Rol.OWNER &&
      userRol !== Rol.MANAGER
    ) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const empleado = await prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });

    if (!empleado) {
      return Response.json({ error: "Empleado no encontrado" }, { status: 404 });
    }

    // MANAGER can only access their tienda's employees (and own profile)
    if (
      userRol === Rol.MANAGER &&
      id !== session.user.id &&
      empleado.tiendaId !== userTiendaId
    ) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    return Response.json(empleado);
  } catch (error) {
    console.error("GET /api/empleados/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const PUT = withTenant(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const userRol = (session.user as any).rol as Rol;

    // Only OWNER or the user themselves can update
    if (id !== session.user.id && userRol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const empleado = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        rol: true,
        // Campos obligatorios actuales (para recalcular perfilCompletado).
        tipoIdentificacion: true,
        dni: true,
        nacionalidad: true,
        estadoCivil: true,
        genero: true,
        fechaNacimiento: true,
        domicilio: true,
        codigoPostal: true,
        localidad: true,
        provincia: true,
        pais: true,
        telefono: true,
        emailPersonal: true,
      },
    });
    if (!empleado) {
      return Response.json({ error: "Empleado no encontrado" }, { status: 404 });
    }

    const body = await request.json();
    const {
      email,
      password,
      nombre,
      apellidos,
      dni,
      telefono,
      fechaNacimiento,
      foto,
      rol,
      tiendaId,
      managerId,
      activo,
      salarioBase,
      horasSemanalesContrato,
    } = body as {
      email?: string;
      password?: string;
      nombre?: string;
      apellidos?: string;
      dni?: string;
      telefono?: string;
      fechaNacimiento?: string | null;
      foto?: string;
      rol?: Rol;
      tiendaId?: string;
      managerId?: string | null;
      activo?: boolean;
      salarioBase?: number | null;
      horasSemanalesContrato?: number | null;
    };

    // Non-admins cannot change their own role or tienda
    if (id === session.user.id && userRol !== Rol.OWNER) {
      if (rol !== undefined || tiendaId !== undefined) {
        return Response.json(
          { error: "No puedes cambiar tu propio rol o tienda" },
          { status: 403 }
        );
      }
    }

    // Check email uniqueness if changing email
    if (email && email !== empleado.email) {
      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        return Response.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};
    if (email !== undefined) updateData.email = email;
    if (nombre !== undefined) updateData.nombre = nombre;
    if (apellidos !== undefined) updateData.apellidos = apellidos;
    // dni es @unique: "" debe guardarse como null (dos vacíos colisionan).
    if (dni !== undefined) updateData.dni = norm(dni);
    if (telefono !== undefined) updateData.telefono = norm(telefono);
    if (fechaNacimiento !== undefined) {
      updateData.fechaNacimiento = fechaNacimiento ? new Date(fechaNacimiento) : null;
    }
    if (foto !== undefined) updateData.foto = foto;

    // ─── Ficha ampliada: campos de texto (self o admin) ───────────────
    const b = body as Record<string, unknown>;
    for (const campo of CAMPOS_TEXTO_FICHA) {
      if (b[campo] !== undefined) updateData[campo] = norm(b[campo]);
    }
    // Validación ligera de emails (si vienen con valor).
    for (const campo of ["emailEmpresa", "emailPersonal", "emailNotificaciones"] as const) {
      if (updateData[campo] && !EMAIL_RE.test(updateData[campo])) {
        return Response.json({ error: `Email inválido en ${campo}` }, { status: 400 });
      }
    }
    // Booleanos.
    if (typeof b.compartirCumpleanos === "boolean") updateData.compartirCumpleanos = b.compartirCumpleanos;
    if (typeof b.teletrabajo === "boolean") updateData.teletrabajo = b.teletrabajo;
    // Numéricos con validación de rango.
    if (b.numeroHijos !== undefined) {
      const n = b.numeroHijos;
      if (n === null || n === "") updateData.numeroHijos = null;
      else if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 30) updateData.numeroHijos = n;
      else return Response.json({ error: "numeroHijos inválido (0–30)" }, { status: 400 });
    }
    if (b.porcentajeDiscapacidad !== undefined) {
      const n = b.porcentajeDiscapacidad;
      if (n === null || n === "") updateData.porcentajeDiscapacidad = null;
      else if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100) updateData.porcentajeDiscapacidad = n;
      else return Response.json({ error: "porcentajeDiscapacidad inválido (0–100)" }, { status: 400 });
    }

    // Recalcular perfilCompletado contra el set obligatorio centralizado
    // (lib/empleados/perfil) usando los valores efectivos (merge de los
    // actuales del empleado + los que vengan en este update).
    const efectivo = { ...empleado, ...updateData };
    updateData.perfilCompletado = esPerfilCompleto(efectivo);
    if (rol !== undefined && userRol === Rol.OWNER) updateData.rol = rol;
    if (tiendaId !== undefined && userRol === Rol.OWNER) updateData.tiendaId = tiendaId;
    if (managerId !== undefined && (userRol === Rol.OWNER || userRol === Rol.MANAGER)) {
      // No permitir auto-asignación como manager.
      if (managerId === id) {
        return Response.json(
          { error: "Un empleado no puede ser su propio manager" },
          { status: 400 },
        );
      }
      updateData.managerId = managerId;
    }
    if (activo !== undefined && userRol === Rol.OWNER) updateData.activo = activo;
    if (salarioBase !== undefined && userRol === Rol.OWNER) {
      if (salarioBase === null) {
        updateData.salarioBase = null;
      } else if (typeof salarioBase === "number" && salarioBase >= 0 && salarioBase <= 1_000_000) {
        updateData.salarioBase = salarioBase;
      } else {
        return Response.json(
          { error: "salarioBase_invalid", reason: "número entre 0 y 1.000.000 €" },
          { status: 400 },
        );
      }
    }
    if (horasSemanalesContrato !== undefined && userRol === Rol.OWNER) {
      if (horasSemanalesContrato === null) {
        updateData.horasSemanalesContrato = null;
      } else if (
        typeof horasSemanalesContrato === "number" &&
        horasSemanalesContrato >= 0 &&
        horasSemanalesContrato <= 168
      ) {
        updateData.horasSemanalesContrato = horasSemanalesContrato;
      } else {
        return Response.json(
          { error: "horasSemanalesContrato_invalid", reason: "número entre 0 y 168 h" },
          { status: 400 },
        );
      }
    }

    if (password) {
      updateData.password = await bcrypt.hash(password, 12);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: userSelect,
    });

    return Response.json(updated);
  } catch (error) {
    console.error("PUT /api/empleados/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const DELETE = withTenant(async (_request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;

    if (id === session.user.id) {
      return Response.json({ error: "No puedes eliminar tu propia cuenta" }, { status: 400 });
    }

    const empleado = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!empleado) {
      return Response.json({ error: "Empleado no encontrado" }, { status: 404 });
    }

    // Hard delete — remove related records first to satisfy FK constraints
    await prisma.$transaction(async (tx) => {
      await tx.pushSubscripcion.deleteMany({ where: { userId: id } });
      await tx.preferenciasNotificacion.deleteMany({ where: { userId: id } });
      await tx.notificacion.deleteMany({ where: { userId: id } });
      await tx.fichaje.deleteMany({ where: { userId: id } });
      await tx.turno.deleteMany({ where: { userId: id } });
      await tx.ausencia.deleteMany({ where: { userId: id } });
      await tx.ausencia.updateMany({ where: { aprobadoPorId: id }, data: { aprobadoPorId: null } });
      await tx.tarea.deleteMany({ where: { asignadoAId: id, creadoPorId: { not: id } } });
      await tx.tarea.deleteMany({ where: { creadoPorId: id } });
      await tx.comunicado.deleteMany({ where: { autorId: id } });
      await tx.articulo.deleteMany({ where: { autorId: id } });
      await tx.documento.deleteMany({ where: { userId: id } });
      await tx.documento.deleteMany({ where: { subidoPorId: id } });
      await tx.procesoOnboarding.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/empleados/[id] error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
