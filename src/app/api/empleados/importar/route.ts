/**
 * POST /api/empleados/importar
 *
 * Sube la plantilla Excel editada y actualiza EN BLOQUE los empleados
 * existentes (match por Email). Solo actualiza; no crea empleados ni
 * columnas. Celda vacía = sin cambios. Devuelve un resumen por filas.
 *
 * Multipart form-data con campo `file`. Lógica en `src/lib/empleados/
 * importar.ts` recibiendo `prismaApp` por dependencia (sin fetch interno).
 * Envuelto en `withTenant`.
 */

import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { NextResponse, type NextRequest } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { resolveEmpresaScope } from "@/lib/multi-empresa/scope";
import { importarEmpleados } from "@/lib/empleados/importar";

// Límite defensivo del archivo (Excel de directorio de empleados es pequeño).
const MAX_BYTES = 5 * 1024 * 1024;

export const POST = withTenant(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const userRol = (session.user as { rol: Rol }).rol;
  if (userRol !== Rol.OWNER) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f && typeof f !== "string") file = f as File;
  } catch {
    return NextResponse.json({ error: "form_data_invalido" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: "Falta el archivo (campo 'file')" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo es demasiado grande (máx 5 MB)" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const scope = await resolveEmpresaScope(session);

  try {
    const resultado = await importarEmpleados(prismaApp, buffer, {
      empresaId: scope.empresaId ?? null,
    });
    return NextResponse.json(resultado);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo leer el archivo" },
      { status: 400 },
    );
  }
});
