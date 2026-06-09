/**
 * GET /api/tiendas/geocodificar?direccion=&ciudad=&cp=
 *
 * Devuelve lat/long para una dirección (Nominatim). Lo usa el botón
 * "Ubicar automáticamente" del formulario de sedes para previsualizar y
 * afinar las coordenadas antes de guardar.
 */

import { auth } from "@/lib/auth";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { geocodeAddress } from "@/lib/tiendas/geocode";

export const GET = withTenant(async (request: NextRequest) => {
  const session = await auth();
  const user = session?.user as { rol?: Rol } | undefined;
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (user.rol !== Rol.OWNER) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const direccion = searchParams.get("direccion");
  const ciudad = searchParams.get("ciudad");
  const cp = searchParams.get("cp");

  const geo = await geocodeAddress(direccion, ciudad, cp);
  if (!geo) {
    return NextResponse.json(
      { error: "no_encontrada", message: "No se pudo ubicar la dirección." },
      { status: 404 },
    );
  }
  return NextResponse.json(geo);
});
