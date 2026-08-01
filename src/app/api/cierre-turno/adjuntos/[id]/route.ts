/**
 * GET /api/cierre-turno/adjuntos/[id] — descarga el fichero.
 *
 * Quién puede: su autor, cualquiera de la MISMA SEDE del cierre, el coordinador
 * y cualquier administrador. Aplicado en la consulta y no después, para que un
 * id ajeno no devuelva nada.
 *
 * Por qué la sede y no solo el autor (ticket 2e6b91f4): al entrar a trabajar se
 * le pide al comercial que revise el fondo de caja y el stock que le deja el
 * turno anterior, y esos dos datos son justo el Excel de stock y el comprobante
 * del TPV que van adjuntos al cierre de su compañero. Pedirle que revise algo
 * que no puede abrir no tiene sentido. Es información de la tienda —cuánto
 * efectivo y qué existencias—, no datos personales de nadie.
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
    // Administración lo ve todo; el resto, lo de sus sedes. Un comercial con
    // alcance "propio" también entra por aquí: sus sedes son la suya (y las que
    // le hayan asignado), que es de donde tiene que revisar la caja y el stock.
    const sedesPropias =
      alcance === "todos"
        ? []
        : await sedesDelUsuario(prisma, { userId: session.user.id!, tiendaId: tiendaPropia });
    const adjunto = await prisma.cierreCajaAdjunto.findFirst({
      where: {
        id,
        caja: {
          cierre:
            alcance === "todos"
              ? {}
              : {
                  // Suyo o de su sede: si no tiene ninguna asignada, `in: []` no
                  // devuelve nada y le quedan solo los propios.
                  OR: [{ userId }, { tiendaId: { in: sedesPropias } }],
                },
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
