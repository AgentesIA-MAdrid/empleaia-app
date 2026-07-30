/**
 * Acceso anticipado al módulo de cierre de turno, persona a persona.
 *
 * GET /api/cierre-turno/pilotos — quién lo estrena y a quién se le puede dar.
 * PUT /api/cierre-turno/pilotos — da o quita el acceso a una persona.
 *
 * Para qué: estrenar el módulo con quien se presta a probarlo en su tienda sin
 * abrírselo a la plantilla entera. La alternativa era hacerla administradora, y
 * eso le daría acceso a nóminas, empleados y canal de denuncias — permisos que
 * no tienen nada que ver con cerrar su caja.
 *
 * Solo administración: decide quién ve un módulo que todavía se está probando.
 *
 * Ojo con la sede: quien no la tenga asignada podrá abrir el asistente pero su
 * cierre quedará sin sede (fuera de los cuadres de conciliación) y no podrá
 * declarar arqueos. El GET lo dice por cada persona para que se vea antes.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

async function soloAdmin(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (((session.user as any).rol as string) !== "OWNER") {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Solo administración decide quién estrena el módulo." },
        { status: 403 },
      ),
    };
  }
  return { ok: true };
}

export const GET = withTenant(
  withFeature("cierre_turno", async () => {
    const quien = await soloAdmin();
    if (!quien.ok) return quien.res;

    const [cfg, usuarios] = await Promise.all([
      prisma.configuracionEmpresa.findUnique({
        where: { id: "singleton" },
        select: { cierreTurnoEnRodaje: true },
      }),
      prisma.user.findMany({
        where: { activo: true, rol: { not: "OWNER" } },
        select: {
          id: true,
          nombre: true,
          apellidos: true,
          rol: true,
          cierreTurnoPiloto: true,
          tienda: { select: { nombre: true } },
        },
        orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
      }),
    ]);

    return NextResponse.json({
      // Si el módulo ya está abierto al equipo, esta lista es informativa: todos
      // lo ven de todas formas.
      enRodaje: cfg?.cierreTurnoEnRodaje ?? true,
      personas: usuarios.map((u) => ({
        id: u.id,
        nombre: `${u.nombre} ${u.apellidos}`.trim(),
        rol: u.rol,
        sede: u.tienda?.nombre ?? null,
        acceso: u.cierreTurnoPiloto,
      })),
    });
  }),
);

export const PUT = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const quien = await soloAdmin();
    if (!quien.ok) return quien.res;

    const body = (await req.json().catch(() => null)) as {
      userId?: unknown;
      acceso?: unknown;
    } | null;
    if (!body || typeof body.userId !== "string" || typeof body.acceso !== "boolean") {
      return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
    }

    const persona = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true, nombre: true, apellidos: true, tiendaId: true, activo: true },
    });
    if (!persona) return NextResponse.json({ error: "Esa persona no existe." }, { status: 404 });
    if (!persona.activo && body.acceso) {
      return NextResponse.json(
        { error: "Esa persona está dada de baja." },
        { status: 409 },
      );
    }

    await prisma.user.update({
      where: { id: persona.id },
      data: { cierreTurnoPiloto: body.acceso },
    });

    return NextResponse.json({
      ok: true,
      nombre: `${persona.nombre} ${persona.apellidos}`.trim(),
      acceso: body.acceso,
      // Sin sede, su cierre no entra en los cuadres y no puede arquear: se
      // avisa aquí para que se resuelva antes de que empiece a registrar.
      avisoSinSede: body.acceso && persona.tiendaId === null,
    });
  }),
);
