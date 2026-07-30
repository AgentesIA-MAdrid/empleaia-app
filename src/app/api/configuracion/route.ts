import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
export const GET = withTenant(async () => {
  try {

    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const config = await prisma.configuracionEmpresa.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
    });

    const user = session.user as { rol?: string };
    if (user.rol !== Rol.OWNER) {
      return Response.json({
        nombre: config.nombre,
        horasJornadaDiaria: config.horasJornadaDiaria,
        horasSemanales: config.horasSemanales,
        toleranciaFichaje: config.toleranciaFichaje,
        geofencingActivo: config.geofencingActivo,
        geoObligatoria: config.geoObligatoria,
        faceIdObligatorio: config.faceIdObligatorio,
        faceIdGuardarFoto: config.faceIdGuardarFoto,
        fichajeMovilActivo: config.fichajeMovilActivo,
        fichajeTabletActivo: config.fichajeTabletActivo,
      });
    }

    return Response.json({ ...config, pushVapidPrivateKey: undefined });
  } catch (error) {
    console.error("GET /api/configuracion error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const PUT = withTenant(async (request: NextRequest) => {
  try {

    const session = await auth();
    const user = session?.user as { rol?: string } | undefined;
    if (!user || user.rol !== Rol.OWNER) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();

    // Allowlist — never touch VAPID private key, logo/favicon (handled by /branding), or id
    const data: Record<string, unknown> = {};
    const allowed = [
      "nombre", "appNombre",
      "horasJornadaDiaria", "horasSemanales", "toleranciaFichaje",
      "geofencingActivo", "fichajeMovilActivo", "fichajeTabletActivo",
      "geoObligatoria", "faceIdObligatorio", "faceIdGuardarFoto", "retencionFotosDias",
      "notifAusencias", "notifTurnos", "notifTareas", "notifFichajes", "notifComunicados", "notifDocumentos",
      "notifFueraSede",
      // Aviso diario de cierres de turno sin terminar (módulo Enterprise): se
      // manda a la hora local que elija cada cliente.
      "avisoCierresActivo", "avisoCierresHora", "avisoCierresZona",
      // Precios en el catálogo de ventas: con esto encendido, el módulo lee
      // las ventas también en euros. Se cambia desde la pestaña Catálogo.
      "ventasPreciosActivos",
      // Cierre de turno en rodaje: quién ve el módulo mientras se configura.
      "cierreTurnoEnRodaje",
      "emailActivo", "emailHost", "emailPort", "emailSecure", "emailUser", "emailPassword", "emailFrom",
      "pushActivo", "pushVapidPublicKey",
      "colorPrimario", "colorSidebar",
      // Fase 6 §3.1: configuración general por tenant.
      "zonaHoraria", "diasLaborables", "ausenciasDefaults",
      // Reglas de cálculo de prenómina (Enterprise-ready).
      "nominaJornadaSemanal", "nominaHoraExtraFactor",
      "nominaPlusNocturnidadActivo", "nominaNocturnidadDesde", "nominaNocturnidadHasta",
      "nominaPlusNocturnidadFactor",
      "nominaPlusFestivoActivo", "nominaPlusFestivoFactor",
      "nominaSalarioBaseDefault", "nominaMoneda",
    ];
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }

    // Validación campos Fase 6.
    if ("diasLaborables" in data) {
      const v = data.diasLaborables;
      if (
        !Array.isArray(v) ||
        v.some((x) => typeof x !== "number" || x < 0 || x > 6 || !Number.isInteger(x))
      ) {
        return Response.json(
          { error: "diasLaborables_invalid", reason: "array de enteros 0-6" },
          { status: 400 },
        );
      }
    }
    if ("retencionFotosDias" in data) {
      const v = data.retencionFotosDias;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 3650) {
        return Response.json(
          { error: "retencionFotosDias_invalid", reason: "entero entre 1 y 3650 días" },
          { status: 400 },
        );
      }
    }
    if ("zonaHoraria" in data) {
      try {
        new Intl.DateTimeFormat("es-ES", { timeZone: String(data.zonaHoraria) });
      } catch {
        return Response.json(
          { error: "zonaHoraria_invalid", reason: "no reconocida por Intl" },
          { status: 400 },
        );
      }
    }

    const config = await prisma.configuracionEmpresa.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });

    return Response.json({ ...config, pushVapidPrivateKey: undefined });
  } catch (error) {
    console.error("PUT /api/configuracion error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});
