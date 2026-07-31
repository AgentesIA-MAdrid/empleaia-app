import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { TipoFichaje, MetodoFichaje, Rol } from "@/generated/prisma-tenant/client";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/tenant/with-tenant";
import { getLimit, hasFeature } from "@/lib/tenant/features";
import { detectDeviceTypeFromUA } from "@/lib/device-ua";
import { encrypt } from "@/lib/crypto/aes-gcm";
import { consumeFaceToken } from "@/lib/face/token";
import { currentTenant } from "@/lib/tenant/context";
import { resolveEmpresaScope, fichajeScopeFilter } from "@/lib/multi-empresa/scope";
import { calcularDistancia } from "@/lib/utils";
import { notifyFichajeFueraSede } from "@/lib/fichajes/notify-fuera-sede";
import { evaluarFichajeEnHorario } from "@/lib/fichajes/horario-turno";
import {
  admiteChecklist,
  resolverChecklist,
  type ConfirmacionChecklist,
  type RespuestaChecklist,
} from "@/lib/fichajes/checklist";
export const GET = withTenant(async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const tiendaId = searchParams.get("tiendaId");
    const userId = searchParams.get("userId");
    const fecha = searchParams.get("fecha");

    const userRol = (session.user as any).rol as Rol;
    const userTiendaId = (session.user as any).tiendaId as string | null;

    // Build where clause based on role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (userRol === Rol.OWNER) {
      if (tiendaId) where.tiendaId = tiendaId;
      if (userId) where.userId = userId;
    } else if (userRol === Rol.MANAGER) {
      where.tiendaId = userTiendaId;
      if (userId) where.userId = userId;
    } else {
      // EMPLEADO
      where.userId = session.user.id;
    }

    if (fecha) {
      const start = new Date(fecha);
      start.setHours(0, 0, 0, 0);
      const end = new Date(fecha);
      end.setHours(23, 59, 59, 999);
      where.timestamp = { gte: start, lte: end };
    } else {
      // Plan Fase 5 §5.1 + coverage: historial_meses limit. El plan
      // starter expone 6 meses, pro 36, enterprise null (sin límite).
      // Si limit es null o falta loader, no filtrar.
      const meses = getLimit("historial_meses");
      if (meses !== null && meses > 0) {
        const horizon = new Date();
        horizon.setMonth(horizon.getMonth() - meses);
        where.timestamp = { ...(where.timestamp ?? {}), gte: horizon };
      }
    }

    // Aislamiento multi_empresa.
    const empresaScope = await resolveEmpresaScope(session);
    Object.assign(where, fichajeScopeFilter(empresaScope));

    const fichajes = await prisma.fichaje.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            nombre: true,
            apellidos: true,
            email: true,
          },
        },
        tienda: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
      orderBy: { timestamp: "desc" },
    });

    return Response.json(fichajes);
  } catch (error) {
    console.error("GET /api/fichajes error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

export const POST = withTenant(async (request: NextRequest) => {
  try {

    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const {
      tipo,
      latitud,
      longitud,
      distancia,
      metodo = MetodoFichaje.WEB,
      nota,
      faceVerifyToken,
      fotoSnapshot,
      checklist,
    } = body as {
      tipo: TipoFichaje;
      latitud?: number;
      longitud?: number;
      distancia?: number;
      metodo?: MetodoFichaje;
      nota?: string;
      /** Token HMAC single-use emitido por POST /api/face/verify. TTL 60s. */
      faceVerifyToken?: string;
      /** Data URL JPEG ≤200 KB. Solo se guarda si el tenant lo activó. */
      fotoSnapshot?: string;
      /** Puntos de control confirmados por el empleado (ticket c4bc33d6). */
      checklist?: RespuestaChecklist[];
    };

    if (!tipo || !Object.values(TipoFichaje).includes(tipo)) {
      return Response.json({ error: "Tipo de fichaje inválido" }, { status: 400 });
    }

    const userId = session.user.id;
    const userTiendaId = (session.user as any).tiendaId as string | null;

    // Get the last fichaje to validate state transitions
    const ultimoFichaje = await prisma.fichaje.findFirst({
      where: { userId },
      orderBy: { timestamp: "desc" },
    });

    const ultimoTipo = ultimoFichaje?.tipo ?? null;

    // Validate state transitions
    const validationError = validateTipoFichaje(tipo, ultimoTipo);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    // Get IP from headers
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0].trim() : null;

    // Plan Fase 5 §5.1: geofencing es CORE-safe — NUNCA rechaza el
    // fichaje (RD 8/2019). Solo controla si registramos lat/lon y
    // distancia para auditoría. Sin la feature, descartamos los
    // datos de geolocalización aunque el cliente los envíe.
    const geofencingActivo = hasFeature("geofencing");
    const lat = geofencingActivo ? latitud : null;
    const lon = geofencingActivo ? longitud : null;

    // La distancia a la sede se calcula SIEMPRE en el servidor a
    // partir de las coordenadas de la tienda asignada. El cliente web
    // nunca la enviaba (quedaba `undefined`), así que `distancia` se
    // guardaba a null en todos los fichajes y el OWNER no podía
    // auditar desde dónde se fichó. Además, un valor enviado por el
    // cliente no es auditable: puede falsearse.
    let dist: number | null = null;
    // Sede del empleado con su radio: si la distancia lo supera, avisamos
    // por email a los administradores (ver más abajo, tras el create).
    let sede: { id: string; nombre: string; radio: number } | null = null;
    // Modo estricto de la sede (ticket #61): fuera del radio no se ficha
    // directo; hay que justificarlo y lo aprueba un OWNER.
    let exigeEnSede = false;
    // Sede del empleado, se consulte o no la distancia: hace falta saber si
    // exige presencia aunque el navegador no haya dado coordenadas.
    const tienda = userTiendaId
      ? await prisma.tienda.findUnique({
          where: { id: userTiendaId },
          select: {
            id: true, nombre: true, radio: true, latitud: true, longitud: true,
            exigirFichajeEnSede: true,
          },
        })
      : null;
    // El modo estricto solo puede aplicarse si hay con qué comparar: sede
    // con coordenadas y la feature de geofencing en el plan.
    exigeEnSede =
      geofencingActivo &&
      tienda?.exigirFichajeEnSede === true &&
      tienda.latitud != null &&
      tienda.longitud != null;

    if (geofencingActivo && lat != null && lon != null) {
      if (tienda?.latitud != null && tienda?.longitud != null) {
        dist = Math.round(calcularDistancia(lat, lon, tienda.latitud, tienda.longitud));
        sede = { id: tienda.id, nombre: tienda.nombre, radio: tienda.radio };
      } else if (typeof distancia === "number" && Number.isFinite(distancia)) {
        // Sede sin coordenadas (o empleado sin sede): conservamos lo
        // que envíe el cliente/integración para no perder el dato.
        dist = Math.round(distancia);
      }
    }

    // Políticas de tenant: geo + Face ID + device gating.
    const cfg = await prisma.configuracionEmpresa.findUnique({
      where: { id: "singleton" },
      select: {
        geoObligatoria: true,
        faceIdObligatorio: true,
        faceIdGuardarFoto: true,
        fichajeMovilActivo: true,
        fichajeTabletActivo: true,
        checklistFichajeActivo: true,
        exigirFichajeEnHorario: true,
        margenFichajeMinutos: true,
        zonaHoraria: true,
      },
    });

    // Si el OWNER apaga el fichaje desde móvil/tablet, rechazamos
    // requests cuyo UA encaje. Detección por UA (heurística — no
    // perfecta pero coherente con el gating cliente-side).
    // Plan Fase 5 §6.1 + RD 8/2019: el toggle local solo aplica si el
    // plan tiene la feature correspondiente. Sin la feature, el toggle
    // no existe (UI lo oculta) y aceptamos el fichaje siempre.
    const ua = request.headers.get("user-agent") || "";
    const dev = detectDeviceTypeFromUA(ua);
    if (
      hasFeature("fichaje_movil") &&
      dev === "mobile" &&
      cfg?.fichajeMovilActivo === false
    ) {
      return Response.json(
        { error: "El fichaje desde móvil está deshabilitado por tu empresa." },
        { status: 400 },
      );
    }
    if (
      hasFeature("fichaje_tablet") &&
      dev === "tablet" &&
      cfg?.fichajeTabletActivo === false
    ) {
      return Response.json(
        { error: "El fichaje desde tablet está deshabilitado por tu empresa." },
        { status: 400 },
      );
    }

    if (geofencingActivo && cfg?.geoObligatoria && (lat == null || lon == null)) {
      return Response.json(
        { error: "Tu empresa requiere localización para fichar. Activa el GPS y vuelve a intentarlo." },
        { status: 400 },
      );
    }

    // Ticket #61 — modo estricto de la sede. La sede exige fichar dentro de
    // su radio, así que sin coordenadas no hay nada que comprobar: pedirlas
    // es obligatorio, o bastaría con apagar el GPS para saltarse el control.
    if (exigeEnSede && (lat == null || lon == null)) {
      return Response.json(
        {
          error: "Tu sede exige fichar desde el puesto de trabajo. Activa la localización y vuelve a intentarlo.",
          code: "ubicacion_requerida",
        },
        { status: 400 },
      );
    }

    // Fuera del radio no se registra el fichaje directamente: el empleado
    // tiene que explicar el motivo, y eso crea una SolicitudFichaje que
    // aprueba un OWNER (POST /api/solicitudes-fichaje, clase "fuera_sede").
    // Así la jornada nunca se pierde —RD 8/2019— pero no entra sin control.
    if (exigeEnSede && sede && dist != null && dist > sede.radio) {
      return Response.json(
        {
          error: `Estás a ${dist} m de ${sede.nombre} y tu sede exige fichar desde el puesto de trabajo (máximo ${sede.radio} m).`,
          code: "fuera_de_sede",
          distancia: dist,
          radio: sede.radio,
          sede: { id: sede.id, nombre: sede.nombre },
        },
        { status: 409 },
      );
    }

    // Ticket 25c81b6b — fichar dentro del horario del cuadrante. Mismo
    // patrón que el modo estricto de sede: se bloquea el camino fácil, no el
    // registro de la jornada (RD 8/2019). El empleado puede pedir desde la
    // ventana emergente que se registre ajustado a su turno, y eso crea una
    // SolicitudFichaje clase "fuera_horario" que aprueba un responsable.
    // Solo se comprueba si el empleado tiene turno PUBLICADO hoy: sin cuadrante
    // de hoy no hay con qué comparar. Se hace antes del checklist y de Face ID para
    // no gastar el token de verificación en un intento que se va a rechazar.
    if (cfg?.exigirFichajeEnHorario) {
      const ev = await evaluarFichajeEnHorario(prisma, {
        userId: userId!,
        ahora: new Date(),
        margenMin: cfg.margenFichajeMinutos,
        zona: cfg.zonaHoraria,
      });
      if (ev.estado === "fuera") {
        const cuando = ev.motivo === "antes" ? "aún no ha empezado" : "ya ha terminado";
        return Response.json(
          {
            error: `Tu turno de ${ev.turno.horaInicio} a ${ev.turno.horaFin} ${cuando} y tu empresa no permite fichar fuera del horario del cuadrante.`,
            code: "fuera_de_horario",
            motivo: ev.motivo,
            turno: { horaInicio: ev.turno.horaInicio, horaFin: ev.turno.horaFin },
            ajuste: ev.ajuste.toISOString(),
            ajusteHora: ev.ajusteHora,
            margen: cfg.margenFichajeMinutos,
          },
          { status: 409 },
        );
      }
    }

    // Checklist de fichaje (ticket c4bc33d6): antes de la ENTRADA y de la
    // SALIDA el empleado confirma los puntos de control que haya definido
    // el OWNER (stock y caja del turno anterior, cierre de caja…). Opt-in
    // por tenant y sin gate de plan. Se comprueba antes que Face ID para
    // no gastar el token de verificación en un intento incompleto.
    let confirmaciones: ConfirmacionChecklist[] = [];
    if (cfg?.checklistFichajeActivo && admiteChecklist(tipo)) {
      const itemsActivos = await prisma.checklistFichajeItem.findMany({
        where: { tipo, activo: true },
        orderBy: { orden: "asc" },
        select: { id: true, tipo: true, texto: true, orden: true, activo: true },
      });
      if (itemsActivos.length > 0) {
        // No se rechaza el fichaje por dejar puntos sin marcar: el registro
        // de jornada no puede impedirse (RD 8/2019, igual que el geofencing
        // estricto del ticket #61). Se guarda lo confirmado y lo NO
        // confirmado, y el administrador lo ve en el detalle del fichaje.
        confirmaciones = resolverChecklist(itemsActivos, checklist).confirmaciones;
      }
    }

    // Validación Face ID server-side: el cliente debe traer un token
    // HMAC-firmado emitido por /api/face/verify (TTL 60s, single-use).
    // Confiar en un boolean del cliente sería trivial de bypassear.
    // Plan Fase 5 §6.1: si el plan no tiene la feature `face_id`, los
    // toggles `faceIdObligatorio`/`faceIdGuardarFoto` se ignoran (el UI
    // los oculta, y aquí actuamos como si estuvieran apagados). Esto
    // evita que un cliente "starter" use Face ID sin pagar el plan.
    const faceIdFeatureOn = hasFeature("face_id");
    const enforceFaceId = faceIdFeatureOn && cfg?.faceIdObligatorio;
    let faceVerifiedServer = false;
    if (enforceFaceId || (faceIdFeatureOn && faceVerifyToken)) {
      const tpl = await prisma.faceTemplate.findUnique({
        where: { userId: userId! },
        select: { id: true },
      });
      if (enforceFaceId && !tpl) {
        return Response.json(
          {
            error: "Tu empresa exige Face ID para fichar. Regístralo en tu perfil antes de continuar.",
            code: "face_id_required",
          },
          { status: 400 },
        );
      }
      if (typeof faceVerifyToken === "string" && faceVerifyToken.length > 0) {
        const consumed = consumeFaceToken(faceVerifyToken, userId!, currentTenant().slug);
        if (consumed.ok) {
          faceVerifiedServer = true;
        } else if (enforceFaceId) {
          return Response.json(
            {
              error: "Verificación Face ID inválida o caducada. Vuelve a verificar tu rostro.",
              code: "face_id_verify_required",
              reason: consumed.reason,
            },
            { status: 400 },
          );
        }
      } else if (enforceFaceId) {
        return Response.json(
          {
            error: "Necesitas verificar tu rostro con Face ID antes de fichar.",
            code: "face_id_verify_required",
          },
          { status: 400 },
        );
      }
    }

    // Snapshot cifrado: solo cuando el plan tiene la feature face_id,
    // el OWNER activó faceIdGuardarFoto y el fichaje viene del flujo
    // Face ID (token validado server-side). Aceptamos hasta 200KB de
    // data URL → ~150KB binarios tras decode.
    let fotoEnc: Uint8Array<ArrayBuffer> | null = null;
    if (faceIdFeatureOn && cfg?.faceIdGuardarFoto && faceVerifiedServer && typeof fotoSnapshot === "string") {
      const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(fotoSnapshot);
      if (m && fotoSnapshot.length <= 200_000) {
        try {
          const bin = Buffer.from(m[2], "base64");
          fotoEnc = encrypt(new Uint8Array(bin));
        } catch (err) {
          console.warn("[/api/fichajes] no se pudo cifrar snapshot:", err);
        }
      }
    }

    const fichaje = await prisma.fichaje.create({
      data: {
        userId: userId!,
        tiendaId: userTiendaId,
        tipo,
        latitud: lat,
        longitud: lon,
        distancia: dist,
        metodo,
        nota,
        ip,
        ...(fotoEnc ? { fotoSnapshotEnc: fotoEnc } : {}),
      },
      include: {
        user: {
          select: { id: true, nombre: true, apellidos: true, email: true },
        },
        tienda: {
          select: { id: true, nombre: true },
        },
      },
    });

    // Confirmaciones del checklist, con el enunciado en snapshot para que
    // el histórico siga siendo legible si el OWNER edita los puntos.
    if (confirmaciones.length > 0) {
      await prisma.fichajeChecklist.createMany({
        data: confirmaciones.map((c) => ({
          fichajeId: fichaje.id,
          itemId: c.itemId,
          texto: c.texto,
          orden: c.orden,
          marcado: c.marcado,
        })),
      });
    }

    // Aviso a administradores si el fichaje cae fuera del radio de la sede
    // (`Tienda.radio`, 200 m por defecto). Solo con la distancia calculada
    // en servidor — la que envía el cliente no es auditable. El fichaje ya
    // está guardado: esto NO lo rechaza (RD 8/2019), solo avisa.
    // Best-effort: notifyFichajeFueraSede nunca lanza.
    if (sede && dist != null && dist > sede.radio) {
      await notifyFichajeFueraSede({
        empleado: {
          id: fichaje.user.id,
          nombre: fichaje.user.nombre,
          apellidos: fichaje.user.apellidos,
        },
        tipo: fichaje.tipo,
        timestamp: fichaje.timestamp,
        distancia: dist,
        sede,
        latitud: lat ?? null,
        longitud: lon ?? null,
      });
    }

    return Response.json(fichaje, { status: 201 });
  } catch (error) {
    console.error("POST /api/fichajes error:", error);
    return Response.json({ error: "Error interno del servidor" }, { status: 500 });
  }
});

function validateTipoFichaje(
  tipo: TipoFichaje,
  ultimoTipo: TipoFichaje | null
): string | null {
  // If no previous fichaje (no active session), only ENTRADA is allowed
  if (ultimoTipo === null || ultimoTipo === TipoFichaje.SALIDA) {
    if (tipo !== TipoFichaje.ENTRADA) {
      return "Debes hacer ENTRADA antes de registrar otro fichaje";
    }
    return null;
  }

  if (ultimoTipo === TipoFichaje.ENTRADA || ultimoTipo === TipoFichaje.VUELTA_PAUSA) {
    if (tipo === TipoFichaje.ENTRADA) {
      return "Ya tienes una entrada activa. Debes hacer SALIDA primero";
    }
    if (tipo === TipoFichaje.VUELTA_PAUSA) {
      return "No estás en pausa. No puedes hacer VUELTA_PAUSA";
    }
    return null; // PAUSA or SALIDA are valid
  }

  if (ultimoTipo === TipoFichaje.PAUSA) {
    if (tipo === TipoFichaje.ENTRADA) {
      return "Ya tienes una entrada activa. Debes hacer SALIDA primero";
    }
    if (tipo === TipoFichaje.PAUSA) {
      return "Ya estás en pausa";
    }
    if (tipo === TipoFichaje.SALIDA) {
      return "Debes hacer VUELTA_PAUSA antes de SALIDA";
    }
    return null; // VUELTA_PAUSA is valid
  }

  return null;
}
