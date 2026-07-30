/**
 * Gestión del PIN de recogida de efectivo.
 *
 * GET    /api/arqueos/pin — quién está autorizado a recoger y quién tiene PIN
 *   puesto (solo administración). Nunca sale el hash, y menos el PIN.
 * PUT    /api/arqueos/pin — fija o cambia un PIN. Administración puede fijar el
 *   de cualquiera (es quien reparte esa responsabilidad); cada persona puede
 *   cambiar el suyo dando el actual.
 * PATCH  /api/arqueos/pin — administración autoriza/desautoriza a alguien a
 *   recoger, y desbloquea a quien se ha quedado fuera por fallar el PIN.
 * DELETE /api/arqueos/pin?userId=… — quita el PIN (deja de poder firmar).
 *
 * Que el rol no baste es deliberado: un coordinador puede no recoger caja nunca
 * y un administrador puede no pasar jamás por la tienda. Lo decide una persona,
 * no la jerarquía.
 */

import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { NextResponse, type NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";
import { normalizarPin } from "@/lib/cierre-turno/arqueos";

/** Coste de bcrypt: el mismo que usa el login del producto. */
const BCRYPT_ROUNDS = 10;

interface Sesion {
  userId: string;
  rol: string;
}

async function sesion(): Promise<Sesion | null> {
  const s = await auth();
  if (!s?.user) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { userId: s.user.id!, rol: (s.user as any).rol as string };
}

export const GET = withTenant(
  withFeature("cierre_turno", async () => {
    const s = await sesion();
    if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (s.rol !== "OWNER") {
      return NextResponse.json(
        { error: "Solo administración gestiona quién recoge el efectivo." },
        { status: 403 },
      );
    }

    const usuarios = await prisma.user.findMany({
      where: { activo: true },
      select: {
        id: true,
        nombre: true,
        apellidos: true,
        rol: true,
        tienda: { select: { nombre: true } },
        puedeRecogerEfectivo: true,
        pinRecogidaHash: true,
        pinRecogidaBloqueoHasta: true,
      },
      orderBy: [{ apellidos: "asc" }, { nombre: "asc" }],
    });

    const ahora = Date.now();
    return NextResponse.json({
      usuarios: usuarios.map((u) => ({
        id: u.id,
        nombre: `${u.nombre} ${u.apellidos}`.trim(),
        rol: u.rol,
        sede: u.tienda?.nombre ?? null,
        autorizado: u.puedeRecogerEfectivo,
        // Solo si tiene PIN, nunca el hash: un hash filtrado es un PIN de 4
        // dígitos reventado en segundos.
        tienePin: Boolean(u.pinRecogidaHash),
        bloqueado: Boolean(u.pinRecogidaBloqueoHasta && u.pinRecogidaBloqueoHasta.getTime() > ahora),
      })),
    });
  }),
);

export const PUT = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const s = await sesion();
    if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as {
      userId?: unknown;
      pin?: unknown;
      pinActual?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });

    const destino = typeof body.userId === "string" && body.userId ? body.userId : s.userId;
    const esPropio = destino === s.userId;
    if (!esPropio && s.rol !== "OWNER") {
      return NextResponse.json(
        { error: "Solo administración puede cambiar el PIN de otra persona." },
        { status: 403 },
      );
    }

    const nuevo = normalizarPin(body.pin);
    if (!nuevo.ok) return NextResponse.json({ error: nuevo.error }, { status: 400 });

    const usuario = await prisma.user.findUnique({
      where: { id: destino },
      select: { id: true, pinRecogidaHash: true, puedeRecogerEfectivo: true },
    });
    if (!usuario) return NextResponse.json({ error: "Esa persona no existe." }, { status: 404 });

    // Cambiar el propio PIN exige el actual. Administración no lo necesita: su
    // caso de uso real es "se le ha olvidado, ponle uno nuevo".
    if (esPropio && s.rol !== "OWNER" && usuario.pinRecogidaHash) {
      const actual = typeof body.pinActual === "string" ? body.pinActual.trim() : "";
      if (!actual || !(await bcrypt.compare(actual, usuario.pinRecogidaHash))) {
        return NextResponse.json({ error: "El PIN actual no es correcto." }, { status: 401 });
      }
    }

    await prisma.user.update({
      where: { id: destino },
      data: {
        pinRecogidaHash: await bcrypt.hash(nuevo.pin, BCRYPT_ROUNDS),
        // Un PIN nuevo limpia intentos y bloqueo: el motivo del bloqueo era no
        // acordarse del anterior.
        pinRecogidaIntentos: 0,
        pinRecogidaBloqueoHasta: null,
        // Poner un PIN a alguien es autorizarlo: si administración le asigna
        // uno, se da por hecho que va a recoger.
        ...(s.rol === "OWNER" && !usuario.puedeRecogerEfectivo ? { puedeRecogerEfectivo: true } : {}),
      },
    });

    return NextResponse.json({ ok: true });
  }),
);

export const PATCH = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const s = await sesion();
    if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (s.rol !== "OWNER") {
      return NextResponse.json(
        { error: "Solo administración decide quién recoge el efectivo." },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => null)) as {
      userId?: unknown;
      autorizado?: unknown;
      desbloquear?: unknown;
    } | null;
    if (!body || typeof body.userId !== "string") {
      return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
    }

    const usuario = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true, pinRecogidaHash: true },
    });
    if (!usuario) return NextResponse.json({ error: "Esa persona no existe." }, { status: 404 });

    const data: {
      puedeRecogerEfectivo?: boolean;
      pinRecogidaIntentos?: number;
      pinRecogidaBloqueoHasta?: Date | null;
    } = {};
    if (typeof body.autorizado === "boolean") data.puedeRecogerEfectivo = body.autorizado;
    if (body.desbloquear === true) {
      data.pinRecogidaIntentos = 0;
      data.pinRecogidaBloqueoHasta = null;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No hay nada que cambiar." }, { status: 400 });
    }

    await prisma.user.update({ where: { id: body.userId }, data });
    return NextResponse.json({
      ok: true,
      // Autorizar a alguien sin PIN no le deja firmar: se avisa para que no se
      // quede a medias.
      avisoSinPin: data.puedeRecogerEfectivo === true && !usuario.pinRecogidaHash,
    });
  }),
);

export const DELETE = withTenant(
  withFeature("cierre_turno", async (req: NextRequest) => {
    const s = await sesion();
    if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (s.rol !== "OWNER") {
      return NextResponse.json({ error: "Solo administración puede quitar un PIN." }, { status: 403 });
    }
    const userId = new URL(req.url).searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "Falta la persona." }, { status: 400 });

    const usuario = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!usuario) return NextResponse.json({ error: "Esa persona no existe." }, { status: 404 });

    await prisma.user.update({
      where: { id: userId },
      data: {
        pinRecogidaHash: null,
        pinRecogidaIntentos: 0,
        pinRecogidaBloqueoHasta: null,
        // Sin PIN no puede firmar; dejarlo "autorizado" sería mentir en la
        // pantalla de arqueos, donde se anuncia a quién esperar.
        puedeRecogerEfectivo: false,
      },
    });
    return NextResponse.json({ ok: true });
  }),
);
