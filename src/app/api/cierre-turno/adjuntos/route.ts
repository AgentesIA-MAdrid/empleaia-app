/**
 * Adjuntos del cierre de caja: el Excel del stock de la tienda y los
 * comprobantes del TPV.
 *
 * POST   — sube un fichero al cierre de caja de hoy del propio comercial.
 * GET    — lista los adjuntos de un cierre (metadatos, sin el contenido).
 * DELETE — quita uno mientras el turno no esté cerrado.
 *
 * Se pueden seguir subiendo aunque la caja ya esté confirmada, mientras el
 * turno no esté cerrado: los comprobantes del datáfono a veces salen minutos
 * después de contar el efectivo, y bloquearlo obligaría a llamar al
 * administrador por algo trivial. Los importes, en cambio, siguen congelados.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { adjuntoAceptado, alcanceSegunRol, diaMadrid } from "@/lib/cierre-turno/core";
import { sedesDelUsuario } from "@/lib/tiendas/sedes-usuario";

const TIPOS = ["stock", "tpv"] as const;

export const POST = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;

    const body = (await req.json().catch(() => null)) as {
      tipo?: unknown;
      nombre?: unknown;
      mime?: unknown;
      contenidoBase64?: unknown;
    } | null;
    if (!body || typeof body.contenidoBase64 !== "string") {
      return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
    }
    const tipo = TIPOS.includes(body.tipo as (typeof TIPOS)[number])
      ? (body.tipo as (typeof TIPOS)[number])
      : null;
    if (!tipo) {
      return NextResponse.json({ error: "Indica si es el stock o un comprobante del TPV." }, { status: 400 });
    }

    const nombre = typeof body.nombre === "string" && body.nombre.trim() ? body.nombre.trim().slice(0, 200) : "archivo";
    const mime = typeof body.mime === "string" ? body.mime : "";

    let datos: Buffer;
    try {
      datos = Buffer.from(body.contenidoBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
    } catch {
      return NextResponse.json({ error: "No se ha podido leer el archivo." }, { status: 400 });
    }

    const permitido = adjuntoAceptado(mime, datos.byteLength);
    if (!permitido.ok) {
      return NextResponse.json({ error: permitido.error }, { status: 400 });
    }

    const fecha = new Date(`${diaMadrid()}T00:00:00Z`);
    const cierre = await prisma.cierreTurno.findUnique({
      where: { userId_fecha: { userId, fecha } },
      select: { id: true, completadoEn: true, caja: { select: { id: true } } },
    });
    if (!cierre) {
      return NextResponse.json(
        { error: "Empieza por registrar las ventas del día.", code: "sin_borrador" },
        { status: 409 },
      );
    }
    if (cierre.completadoEn) {
      return NextResponse.json(
        { error: "Tu turno de hoy ya está cerrado. Pide a un administrador que adjunte lo que falte.", code: "cierre_cerrado" },
        { status: 409 },
      );
    }
    if (!cierre.caja) {
      return NextResponse.json(
        { error: "Antes de adjuntar, guarda los importes de la caja.", code: "sin_caja" },
        { status: 409 },
      );
    }

    const adjunto = await prisma.cierreCajaAdjunto.create({
      data: {
        cajaId: cierre.caja.id,
        tipo,
        nombre,
        mime,
        tamañoBytes: datos.byteLength,
        contenido: new Uint8Array(datos),
      },
      select: { id: true, tipo: true, nombre: true, mime: true, tamañoBytes: true, createdAt: true },
    });

    return NextResponse.json(adjunto, { status: 201 });
  }),
);

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

    const url = new URL(req.url);
    const cierreId = url.searchParams.get("cierreId");

    // Sin cierre concreto: los de hoy del propio usuario.
    const alcance = alcanceSegunRol(rol);
    const sedesPropias =
      alcance === "sede"
        ? await sedesDelUsuario(prisma, { userId: session.user.id!, tiendaId: tiendaPropia })
        : [];
    const where = cierreId
      ? {
          caja: {
            cierre: {
              id: cierreId,
              ...(alcance === "propio"
                ? { userId }
                : alcance === "sede"
                  ? { tiendaId: { in: sedesPropias } }
                  : {}),
            },
          },
        }
      : {
          caja: { cierre: { userId, fecha: new Date(`${diaMadrid()}T00:00:00Z`) } },
        };

    const adjuntos = await prisma.cierreCajaAdjunto.findMany({
      where,
      select: { id: true, tipo: true, nombre: true, mime: true, tamañoBytes: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ adjuntos });
  }),
);

export const DELETE = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = session.user.id!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rol = (session.user as any).rol as string;

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });

    const adjunto = await prisma.cierreCajaAdjunto.findUnique({
      where: { id },
      select: { id: true, caja: { select: { cierre: { select: { userId: true, completadoEn: true } } } } },
    });
    if (!adjunto) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });

    const esPropio = adjunto.caja.cierre.userId === userId;
    const cerrado = Boolean(adjunto.caja.cierre.completadoEn);
    // El comercial puede quitar lo que ha subido él mientras no cierre el
    // turno; después, solo un administrador.
    if (rol !== "OWNER" && (!esPropio || cerrado)) {
      return NextResponse.json({ error: "No puedes quitar este archivo." }, { status: 403 });
    }

    await prisma.cierreCajaAdjunto.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }),
);
