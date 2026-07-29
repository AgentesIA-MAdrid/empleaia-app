/**
 * Cron: avisa a quien administra de los cierres de turno que se han quedado a
 * medias, al final del día.
 *
 * Recorre los tenants activos y, en cada uno, cruza los turnos del día con los
 * cierres registrados. Un correo por sede con todos sus pendientes: con seis
 * tiendas, un correo por comercial y día sería una bandeja imposible y el aviso
 * dejaría de leerse.
 *
 * Solo reclama a quien tenía turno ese día — si no, cualquier día libre saldría
 * como pendiente.
 *
 * Un único cron sirve para TODOS los clientes: no hay que programar nada al dar
 * de alta uno nuevo. Y se salta a los que no tienen contratado el módulo: sin
 * ese filtro, un cliente sin cierre de turno recibiría un correo diciendo que
 * toda su plantilla ha dejado el cierre sin empezar.
 *
 * Programación en Dokploy: CADA HORA. Cada cliente elige a qué hora local
 * quiere el aviso (Configuración → Notificaciones), así que el cron se despierta
 * en punto y solo avisa a quien le toca en ese momento. Una hora global mandaría
 * el correo a media tarde a quien cierra a medianoche, y una hora antes de lo
 * debido a un cliente en Canarias.
 *   0 * * * *  →  curl -fsS -X POST https://app.empleaia.es/api/cron/cierres-incompletos \
 *                     -H "Authorization: Bearer $CRON_SECRET"
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`, igual que el resto de crons.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prismaMaster, prismaApp } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant/context";
import { sendSystemEmail } from "@/lib/email";
import { Rol } from "@/generated/prisma-tenant/client";
import { diaMadrid } from "@/lib/cierre-turno/core";
import { loadFeatureCatalog, loadFeaturesFor, hasFeatureInMap } from "@/lib/tenant/features";
import {
  agruparPendientesPorSede,
  describirPendiente,
  decidirAviso,
  diaARevisar,
} from "@/lib/cierre-turno/vigilancia";

export const dynamic = "force-dynamic";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Revisa un tenant ya en contexto: decide si le toca a esta hora y, si sí,
 * manda los avisos y registra el día para no repetirlo.
 */
async function revisarTenant(
  ahora: Date,
): Promise<{ sedes: number; personas: number; correos: number; motivo: string; dia: string }> {
  const cfgAviso = await prismaApp.configuracionEmpresa.findUnique({
    where: { id: "singleton" },
    select: {
      avisoCierresActivo: true,
      avisoCierresHora: true,
      avisoCierresZona: true,
      avisoCierresUltimoDia: true,
    },
  });

  const decision = decidirAviso(
    {
      activo: cfgAviso?.avisoCierresActivo ?? true,
      hora: cfgAviso?.avisoCierresHora ?? 23,
      zona: cfgAviso?.avisoCierresZona ?? "Europe/Madrid",
      ultimoDia: cfgAviso?.avisoCierresUltimoDia ?? null,
    },
    ahora,
  );
  if (!decision.toca) {
    return { sedes: 0, personas: 0, correos: 0, motivo: decision.motivo, dia: decision.dia };
  }

  const dia = diaARevisar(decision.dia, cfgAviso?.avisoCierresHora ?? 23);
  const fecha = new Date(`${dia}T00:00:00Z`);

  const [turnos, cierres, cfg] = await Promise.all([
    prismaApp.turno.findMany({
      where: { fecha },
      select: {
        userId: true,
        tiendaId: true,
        user: { select: { nombre: true, apellidos: true, activo: true } },
        tienda: { select: { nombre: true } },
      },
    }),
    prismaApp.cierreTurno.findMany({
      where: { fecha },
      select: {
        userId: true,
        detalleJornada: true,
        completadoEn: true,
        caja: { select: { confirmadoEn: true } },
        _count: { select: { ventas: true } },
      },
    }),
    prismaApp.configuracionEmpresa.findUnique({
      where: { id: "singleton" },
      select: { nombre: true, appNombre: true, colorPrimario: true },
    }),
  ]);

  const pendientes = agruparPendientesPorSede(
    turnos
      .filter((t) => t.user.activo)
      .map((t) => ({
        userId: t.userId,
        nombre: `${t.user.nombre} ${t.user.apellidos}`.trim(),
        tiendaId: t.tiendaId,
        tiendaNombre: t.tienda?.nombre ?? null,
      })),
    cierres.map((c) => ({
      userId: c.userId,
      ventas: c._count.ventas,
      detalleJornada: c.detalleJornada,
      cajaConfirmada: Boolean(c.caja?.confirmadoEn),
      completadoEn: c.completadoEn,
    })),
  );

  // Aunque no haya nada pendiente se marca el día: si más tarde alguien deja un
  // cierre a medias, no tiene sentido reabrir el aviso de una jornada cerrada.
  if (pendientes.length === 0) {
    await prismaApp.configuracionEmpresa.update({
      where: { id: "singleton" },
      data: { avisoCierresUltimoDia: decision.dia },
    });
    return { sedes: 0, personas: 0, correos: 0, motivo: "todo_al_dia", dia };
  }

  const empresa = cfg?.nombre ?? cfg?.appNombre ?? "empleaIA";
  const color = cfg?.colorPrimario ?? "#6366f1";
  const diaLegible = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" }).format(fecha);

  let correos = 0;
  let personas = 0;

  for (const sede of pendientes) {
    personas += sede.personas.length;

    // Administración siempre; el coordinador, solo el de esa sede.
    const destinatarios = await prismaApp.user.findMany({
      where: {
        OR: [
          { rol: Rol.OWNER, activo: true },
          ...(sede.tiendaId ? [{ rol: Rol.MANAGER, activo: true, tiendaId: sede.tiendaId }] : []),
        ],
      },
      select: { email: true, nombre: true },
    });

    const lista = sede.personas.map((p) => `<li>${esc(describirPendiente(p))}</li>`).join("");
    const html = `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;max-width:600px">
        <h2 style="color:${esc(color)};font-size:18px;margin:0 0 4px">Cierres de turno sin terminar</h2>
        <p style="color:#555;margin:0 0 16px">${esc(empresa)} · ${esc(sede.tiendaNombre)} · ${esc(diaLegible)}</p>
        <ul style="padding-left:18px;line-height:1.7">${lista}</ul>
        <p style="color:#666;font-size:12px;margin-top:24px">
          Solo se avisa de quien tenía turno hoy. Los cierres se pueden completar al día siguiente.
        </p>
      </div>`;

    const asunto = `${sede.personas.length} cierre${sede.personas.length === 1 ? "" : "s"} sin terminar — ${sede.tiendaNombre}`;

    const envios = await Promise.allSettled(
      destinatarios.filter((d) => d.email).map((d) => sendSystemEmail(d.email, asunto, html)),
    );
    correos += envios.filter((e) => e.status === "fulfilled").length;
  }

  await prismaApp.configuracionEmpresa.update({
    where: { id: "singleton" },
    data: { avisoCierresUltimoDia: decision.dia },
  });

  return { sedes: pendientes.length, personas, correos, motivo: "avisado", dia };
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // El catálogo de features vive en memoria de proceso y lo hidratan las
  // peticiones normales; un cron puede caer en un proceso recién arrancado que
  // aún no lo tiene, y entonces `hasFeatureInMap` lanza y no se avisa a nadie.
  // Verificado en producción: sin esto, todos los tenants fallaban.
  await loadFeatureCatalog();

  const ahora = new Date();
  const tenants = await prismaMaster.tenant.findMany({
    where: { status: "active" },
    select: { id: true, slug: true },
  });

  type Resultado = {
    slug: string;
    sedes: number;
    personas: number;
    correos: number;
    /** Por qué se ha avisado o no: toca, otra_hora, ya_avisado, desactivado… */
    motivo?: string;
    /** Día revisado, en la zona del cliente. */
    dia?: string;
    /** El cliente no tiene el módulo: no se le revisa nada. */
    sinModulo?: boolean;
    error?: string;
  };
  const resultados: Resultado[] = [];

  for (const t of tenants) {
    try {
      // Solo los clientes con el módulo contratado. Se resuelven sus features
      // reales (plan + extras + overrides), no se asume por plan.
      const features = await loadFeaturesFor(t.id);
      if (!hasFeatureInMap(features, "cierre_turno")) {
        resultados.push({ slug: t.slug, sedes: 0, personas: 0, correos: 0, sinModulo: true });
        continue;
      }

      const r = await runWithTenant(
        { tenantId: t.id, slug: t.slug, status: "active", features },
        async () => revisarTenant(ahora),
      );
      resultados.push({ slug: t.slug, ...r });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Un tenant sin el módulo contratado no tiene por qué romper el resto.
      console.error(`[cron/cierres-incompletos] tenant=${t.slug} error:`, msg);
      resultados.push({ slug: t.slug, sedes: 0, personas: 0, correos: 0, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    tenantsProcesados: resultados.length,
    tenantsConModulo: resultados.filter((r) => !r.sinModulo).length,
    totalPersonas: resultados.reduce((n, r) => n + r.personas, 0),
    totalCorreos: resultados.reduce((n, r) => n + r.correos, 0),
    resultados,
  });
}
