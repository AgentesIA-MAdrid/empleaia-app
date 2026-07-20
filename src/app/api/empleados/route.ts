import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import crypto from "crypto";
import type { NextRequest } from "next/server";
import { sendSystemEmail } from "@/lib/email";
import { invitacionTemplate } from "@/lib/email-templates";

import { withTenant } from "@/lib/tenant/with-tenant";
import { currentTenant } from "@/lib/tenant/context";
import { getLimit } from "@/lib/tenant/features";
import { HttpError, wrapHttpErrors } from "@/lib/feature-guard/http-error";
import { buildSetPasswordUrl } from "@/lib/tenant/urls";
import { resolveEmpresaScope } from "@/lib/multi-empresa/scope";
import { enviarPlantilla } from "@/lib/documentos/plantillas";
export const GET = withTenant(async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER && userRol !== Rol.MANAGER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const tiendaId = searchParams.get("tiendaId");
    const rol = searchParams.get("rol") as Rol | null;
    const activo = searchParams.get("activo");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { anonimizadoAt: null }; // ocultar empleados anonimizados (eliminados)

    if (userRol === Rol.OWNER) {
      if (tiendaId) where.tiendaId = tiendaId;
    } else {
      // MANAGER sees only their tienda
      const userTiendaId = (session.user as any).tiendaId as string | null;
      where.tiendaId = userTiendaId;
    }

    if (rol && Object.values(Rol).includes(rol)) {
      where.rol = rol;
    }

    if (activo !== null) {
      where.activo = activo === "true";
    }

    // Aislamiento multi_empresa.
    const scope = await resolveEmpresaScope(session);
    if (scope.empresaId) where.empresaId = scope.empresaId;

    const empleados = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        nombre: true,
        apellidos: true,
        dni: true,
        telefono: true,
        foto: true,
        rol: true,
        tiendaId: true,
        tienda: { select: { id: true, nombre: true } },
        // Multi-sede: todas las sedes del empleado (N:N), con la principal marcada.
        sedes: {
          select: {
            tiendaId: true,
            principal: true,
            tienda: { select: { id: true, nombre: true, color: true } },
          },
        },
        horasSemanalesContrato: true,
        activo: true,
        password: true,
        resetToken: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
    });

    return Response.json({ empleados });
  } catch (error) {
    console.error("GET /api/empleados error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

/**
 * POST /api/empleados — crea un usuario en el tenant actual.
 *
 * Plan Fase 5 §5.5: race-safe contra `max_employees` con advisory
 * transaction lock. Sin él, dos POST concurrentes pueden ambos leer
 * count<max y ambos crear, sobrepasando el límite.
 *
 * Orden:
 *  1. wrapHttpErrors capta HttpError lanzado dentro de la transacción
 *     y lo convierte en 402 con shape estandarizado (ADR-004 §2.10).
 *  2. prismaApp.$transaction abre una tx — el advisory lock se libera
 *     al COMMIT/ROLLBACK automáticamente.
 *  3. pg_advisory_xact_lock(hashtextextended('tenant:max_employees:<id>',0))
 *     serializa los POST concurrentes del mismo tenant.
 *  4. Lectura del count + comparación contra getLimit("max_employees").
 *  5. Si limit_reached → throw HttpError(402) → la tx hace ROLLBACK,
 *     wrapHttpErrors devuelve la respuesta JSON.
 *
 * NO se usa withFeature ni withQuota — `max_employees` es **limit**,
 * no boolean ni quota. Plan Fase 5 §5.5.
 */
export const POST = withTenant(
  wrapHttpErrors(async (request: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const userRol = (session.user as any).rol as Rol;
    if (userRol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json();
    const {
      email,
      nombre,
      apellidos,
      dni,
      telefono,
      foto,
      rol = Rol.EMPLEADO,
      tiendaId,
      managerId,
      horasSemanalesContrato,
      plantillaIds,
    } = body as {
      email: string;
      nombre: string;
      apellidos: string;
      dni?: string;
      telefono?: string;
      foto?: string;
      rol?: Rol;
      tiendaId?: string;
      managerId?: string | null;
      horasSemanalesContrato?: number | null;
      // Plantillas de documentos a enviar al nuevo empleado como parte del alta.
      plantillaIds?: string[];
    };

    if (!email || !nombre || !apellidos) {
      return Response.json(
        { error: "Faltan campos obligatorios: email, nombre, apellidos" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return Response.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
    }

    // El DNI también es único. Validarlo aquí para devolver un mensaje claro
    // (si no, el INSERT viola la constraint y el error sale como "internal").
    if (dni) {
      const existingDni = await prisma.user.findFirst({
        where: { dni },
        select: { nombre: true, apellidos: true, email: true },
      });
      if (existingDni) {
        return Response.json(
          { error: `Ya existe un empleado con ese DNI: ${existingDni.nombre} ${existingDni.apellidos} (${existingDni.email})` },
          { status: 409 },
        );
      }
    }

    // Generate invite token (valid 7 days)
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const { tenantId } = currentTenant();

    const empleado = await prisma.$transaction(async (tx) => {
      // Advisory lock por tenant — serializa POSTs concurrentes.
      // Se libera automáticamente al COMMIT/ROLLBACK de la tx.
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        `tenant:max_employees:${tenantId}`,
      );

      const max = getLimit("max_employees");
      const count = await tx.user.count({ where: { activo: true } });
      if (max !== null && count >= max) {
        throw new HttpError(402, {
          error: "limit_reached",
          feature_key: "max_employees",
          current: count,
          max,
          upgrade_url: "/admin/configuracion/facturacion?upgrade=max_employees",
        });
      }

      return tx.user.create({
        data: {
          email,
          nombre,
          apellidos,
          dni: dni || undefined,
          telefono: telefono || undefined,
          foto: foto || undefined,
          rol,
          tiendaId: tiendaId || null,
          managerId: managerId || null,
          horasSemanalesContrato:
            horasSemanalesContrato === undefined ? null : horasSemanalesContrato,
          resetToken,
          resetTokenExpiry,
        },
        select: {
          id: true,
          email: true,
          nombre: true,
          apellidos: true,
          dni: true,
          telefono: true,
          foto: true,
          rol: true,
          tiendaId: true,
          tienda: { select: { id: true, nombre: true } },
          horasSemanalesContrato: true,
          activo: true,
          password: true,
          resetToken: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    // Email de invitación. Crítico: sin él el empleado no puede entrar.
    // Por eso usamos `sendSystemEmail` (Resend global RESEND_API_KEY)
    // en vez de `sendEmail` (BYOK del tenant — ese requiere que el
    // tenant haya configurado su Resend, lo cual no es realista para
    // flows críticos como una invitación). Operacionales (turnos,
    // ausencias) sí pueden seguir BYOK por separado.
    const tenantSlug = currentTenant().slug;
    const setPasswordUrl = buildSetPasswordUrl(tenantSlug, resetToken);
    try {
      const config = await prisma.configuracionEmpresa.findFirst({
        select: {
          nombre: true, appNombre: true, colorPrimario: true,
          colorSidebar: true, logo: true,
        },
      });
      const empresa = config?.nombre ?? config?.appNombre ?? "Mi Empresa";
      const html = invitacionTemplate({
        nombre,
        apellidos,
        email,
        rol,
        empresa,
        colorPrimario: config?.colorPrimario ?? "#6366f1",
        colorSidebar: config?.colorSidebar ?? "#1e1b4b",
        logo: config?.logo ?? null,
        setPasswordUrl,
      });
      await sendSystemEmail(
        email,
        `Bienvenido/a a ${empresa} — Crea tu contraseña`,
        html,
      );
    } catch (err) {
      // El empleado ya está en BD. El email ha fallado, pero no
      // anulamos el create — el admin puede reenviarlo manualmente
      // desde la ficha del empleado.
      console.error("[/api/empleados] fallo enviando email de invitación:", err);
    }

    // Plantillas de documentos a enviar como parte del alta. Cada una se
    // materializa como un Documento para el nuevo empleado (y solicita firma si
    // procede). Best-effort: un fallo aquí no revierte el alta.
    if (Array.isArray(plantillaIds) && plantillaIds.length > 0) {
      try {
        const ids = [...new Set(plantillaIds.filter((p) => typeof p === "string" && p))];
        const plantillas = await prisma.plantillaDocumento.findMany({ where: { id: { in: ids } } });
        for (const plantilla of plantillas) {
          await enviarPlantilla({
            plantilla,
            destinatarioId: empleado.id,
            solicitadaPorId: (session.user as { id?: string }).id ?? "",
          });
        }
      } catch (err) {
        console.error("[/api/empleados] fallo enviando plantillas del alta:", err);
      }
    }

    return Response.json(empleado, { status: 201 });
  })
);
