/**
 * GET /api/cierre-turno/adjuntos/[id] — descarga el fichero.
 *
 * Quién puede: su autor, el coordinador de la sede del cierre y cualquier
 * administrador. Mismo alcance que el resto del módulo, aplicado en la consulta
 * y no después, para que un id ajeno no devuelva nada.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { alcanceSegunRol } from "@/lib/cierre-turno/core";
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
    const tiendaPropia = (session.user as any).tiendaId as string | null;

    const id = new URL(req.url).pathname.split("/").filter(Boolean).pop();
    if (!id) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });

    const alcance = alcanceSegunRol(rol);
    const sedesPropias =
      alcance === "sede"
        ? await sedesDelUsuario(prisma, { userId: session.user.id!, tiendaId: tiendaPropia })
        : [];
    const adjunto = await prisma.cierreCajaAdjunto.findFirst({
      where: {
        id,
        caja: {
          cierre:
            alcance === "propio"
              ? { userId }
              : alcance === "sede"
                ? { tiendaId: { in: sedesPropias } }
                : {},
        },
      },
      select: { nombre: true, mime: true, contenido: true },
    });
    if (!adjunto) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

    // `attachment` a propósito: un Excel o un PDF subido por un empleado no se
    // abre en el navegador, se descarga. Evita ejecutar nada en el dominio.
    const nombreSeguro = adjunto.nombre.replace(/["\r\n]/g, "_");
    return new NextResponse(Buffer.from(adjunto.contenido), {
      headers: {
        "Content-Type": adjunto.mime || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${nombreSeguro}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }),
);
