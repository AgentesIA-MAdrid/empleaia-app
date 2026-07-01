/**
 * GET /api/empleados/plantilla
 *
 * Descarga la plantilla Excel de actualización masiva: una fila por
 * empleado con sus datos actuales y cabeceras fijas. El OWNER la edita en
 * Excel y la vuelve a subir por `/api/empleados/importar`.
 *
 * Datos con `prismaApp` (mismo scope multi_empresa que el listado). NO
 * fetch interno entre rutas (AGENTS.md). Envuelto en `withTenant`.
 */

import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { resolveEmpresaScope } from "@/lib/multi-empresa/scope";
import { generarPlantillaEmpleados, selectPlantilla } from "@/lib/empleados/importar";

export const GET = withTenant(async () => {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const userRol = (session.user as { rol: Rol }).rol;
  if (userRol !== Rol.OWNER) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { anonimizadoAt: null };
  const scope = await resolveEmpresaScope(session);
  if (scope.empresaId) where.empresaId = scope.empresaId;

  const empleados = await prismaApp.user.findMany({
    where,
    select: selectPlantilla(),
    orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
  });

  const buf = await generarPlantillaEmpleados(empleados as Record<string, unknown>[]);
  const fechaSlug = new Date().toISOString().slice(0, 10);
  const filename = `plantilla_empleados_${fechaSlug}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
    },
  });
});
