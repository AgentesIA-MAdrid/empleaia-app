"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Clock,
  LogIn,
  LogOut,
  Coffee,
  RotateCcw,
  MapPin,
  MapPinOff,
  Loader2,
  Store,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ScanFace,
  ClipboardCheck,
  ClipboardList,
  ChevronRight,
  Paperclip,
  X as XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useFeatures } from "@/lib/hooks/use-features";
import { useDeviceType, deviceFichajeFeature } from "@/lib/device";
import { UpsellCTA } from "@/components/upsell-cta";
import { FaceCapture } from "@/components/face/face-capture";

// ─── Types ────────────────────────────────────────────────────────────────────

type EstadoFichaje = "sin_fichar" | "trabajando" | "en_pausa";
type TipoFichaje = "ENTRADA" | "PAUSA" | "VUELTA_PAUSA" | "SALIDA";
type LocationStatus = "checking" | "found" | "denied" | "outside" | "idle";

interface EstadoResponse {
  estaFichado: boolean;
  enPausa: boolean;
  minutosHoy: number;
  horaEntrada: string | null;
  ultimoFichaje: {
    id: string;
    tipo: TipoFichaje;
    timestamp: string;
    tienda?: { id: string; nombre: string } | null;
  } | null;
}

interface FichajeRegistro {
  id: string;
  tipo: TipoFichaje;
  timestamp: string;
  tienda?: { id: string; nombre: string } | null;
}

/** Punto de control que hay que confirmar antes de fichar (ticket c4bc33d6). */
interface ChecklistItem {
  id: string;
  tipo: TipoFichaje;
  texto: string;
  orden: number;
}

type RespuestaChecklist = { itemId: string; marcado: boolean };

/**
 * Acceso al módulo de cierre de turno para quien está mirando la pantalla de
 * fichaje, más cómo lleva el cierre de hoy. Lo resuelve el servidor en
 * `/api/cierre-turno/acceso` con la misma regla que el menú.
 */
interface AccesoCierre {
  visible: boolean;
  empezado: boolean;
  cerrado: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DIAS_ES = [
  "Domingo", "Lunes", "Martes", "Miércoles",
  "Jueves", "Viernes", "Sábado",
];

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function formatFechaLarga(date: Date): string {
  const dia = DIAS_ES[date.getDay()];
  const num = date.getDate();
  const mes = MESES_ES[date.getMonth()];
  const anio = date.getFullYear();
  return `${dia}, ${num} de ${mes} de ${anio}`;
}

/** Importe en euros, para el acumulado en caja del turno anterior. */
const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

function formatHora(date: Date): string {
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatHoraCorta(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function minutosATexto(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m}m trabajadas hoy`;
  if (m === 0) return `${h}h trabajadas hoy`;
  return `${h}h ${m}m trabajadas hoy`;
}

function tipoLabel(tipo: TipoFichaje): string {
  const labels: Record<TipoFichaje, string> = {
    ENTRADA: "Entrada",
    PAUSA: "Pausa",
    VUELTA_PAUSA: "Vuelta de pausa",
    SALIDA: "Salida",
  };
  return labels[tipo];
}

function tipoColor(tipo: TipoFichaje): string {
  const colors: Record<TipoFichaje, string> = {
    ENTRADA: "bg-emerald-50 text-emerald-800",
    PAUSA: "bg-amber-50 text-amber-800",
    VUELTA_PAUSA: "bg-sky-50 text-sky-800",
    SALIDA: "bg-red-50 text-red-800",
  };
  return colors[tipo];
}

function calcularDistancia(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmpleadoPage() {
  const { toast } = useToast();

  // Ticket #61 — intento de fichaje rechazado por estar fuera del radio de
  // una sede que exige presencia. Guarda el contexto para pedir el motivo y
  // convertirlo en solicitud pendiente de aprobación.
  const [fueraSede, setFueraSede] = useState<{
    tipo: TipoFichaje;
    mensaje: string;
    distancia: number;
    radio: number;
    sede: string;
    lat: number;
    lon: number;
  } | null>(null);
  const [motivoFueraSede, setMotivoFueraSede] = useState("");
  const [enviandoFueraSede, setEnviandoFueraSede] = useState(false);

  // Ticket 25c81b6b — intento de fichaje antes o después del turno del
  // cuadrante en una empresa que no lo permite. Se le recuerda su horario y,
  // cuando el ajuste tiene sentido, se le ofrece registrarlo a la hora del turno
  // (ticket 9e4c2f10). Entrar después del cierre o salir antes de empezar no se
  // ajusta: ahí solo se explica y se le manda a pedirlo (ticket b7d3e5a9).
  const [fueraHorario, setFueraHorario] = useState<{
    tipo: TipoFichaje;
    motivo: "antes" | "despues";
    horaInicio: string;
    horaFin: string;
    ajusteHora: string;
    ajusteISO: string;
    /** false = no hay hora del turno con la que cuadrarlo. */
    ajustable: boolean;
    /** Minutos de cortesía a cada lado del turno que admite el fichaje. */
    margen: number;
    mensaje: string;
  } | null>(null);
  const [motivoFueraHorario, setMotivoFueraHorario] = useState("");
  const [enviandoFueraHorario, setEnviandoFueraHorario] = useState(false);

  // Clock
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Estado fichaje
  const [estado, setEstado] = useState<EstadoFichaje>("sin_fichar");
  const [minutosHoy, setMinutosHoy] = useState(0);
  // ¿Ha fichado ya la entrada hoy? Es la condición para ofrecerle el cierre de
  // turno: antes de empezar la jornada no hay nada que cerrar. Sigue valiendo
  // tras la salida, que es cuando muchos rematan la caja.
  const [entradaHoy, setEntradaHoy] = useState(false);
  const [tiendaNombre, setTiendaNombre] = useState<string | null>(null);
  const [fichajesHoy, setFichajesHoy] = useState<FichajeRegistro[]>([]);
  const [loadingEstado, setLoadingEstado] = useState(true);

  // Geolocation
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

  // Action loading
  const [loadingAction, setLoadingAction] = useState<TipoFichaje | null>(null);

  // Política de Face ID del tenant + estado del template del usuario.
  const [faceRequired, setFaceRequired] = useState<boolean>(false);
  const [faceSavePhoto, setFaceSavePhoto] = useState<boolean>(false);
  const [hasFaceTemplate, setHasFaceTemplate] = useState<boolean | null>(null);
  // Cuando el usuario pulsa fichar y Face ID es obligatorio, abrimos
  // un modal de captura. Tras match, ejecutamos el fichaje real.
  const [pendingFaceTipo, setPendingFaceTipo] = useState<TipoFichaje | null>(null);
  const [faceVerifying, setFaceVerifying] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);

  // Checklist de fichaje (ticket c4bc33d6): puntos que el empleado tiene
  // que confirmar antes de la ENTRADA y antes de la SALIDA. Solo se pide
  // si el OWNER lo activó y hay puntos definidos para ese tipo.
  const [checklistActivo, setChecklistActivo] = useState(false);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [pendingChecklistTipo, setPendingChecklistTipo] = useState<TipoFichaje | null>(null);
  /**
   * Lo que dejó el turno anterior en su tienda (ticket 2e6b91f4): el fondo de
   * caja, el Excel del stock y la incidencia que escribiera. Se le pedía
   * revisarlo en los puntos de control y no había forma de verlo.
   */
  /** Efectivo acumulado registrado de su sede: contra esto cuenta el cajón al abrir. */
  const [fondoCaja, setFondoCaja] = useState<{
    fecha: string;
    importe: number | null;
    incidencia: string | null;
    sede: string | null;
  } | null>(null);
  const [cierreAnterior, setCierreAnterior] = useState<{
    fecha: string;
    quien: string;
    sede: string | null;
    incidencia: string | null;
    caja: {
      efectivo: number;
      tarjeta: number;
      confirmada: boolean;
      adjuntos: { id: string; tipo: string; nombre: string }[];
    } | null;
  } | null>(null);
  const [checksMarcados, setChecksMarcados] = useState<Record<string, boolean>>({});
  // Confirmaciones ya hechas, en espera de que termine el Face ID.
  const [respuestasChecklist, setRespuestasChecklist] = useState<RespuestaChecklist[] | null>(null);

  // Cierre de turno: si el cliente tiene el módulo y a esta persona le toca
  // verlo, se le ofrece bajo el cuadro de fichaje.
  const [accesoCierre, setAccesoCierre] = useState<AccesoCierre | null>(null);

  // Fetch estado
  const fetchEstado = useCallback(async () => {
    try {
      const res = await fetch("/api/fichajes/estado");
      if (!res.ok) throw new Error("Error al obtener estado");
      const data: EstadoResponse = await res.json();

      if (!data.estaFichado) {
        setEstado("sin_fichar");
      } else if (data.enPausa) {
        setEstado("en_pausa");
      } else {
        setEstado("trabajando");
      }

      setMinutosHoy(data.minutosHoy ?? 0);
      setEntradaHoy(data.horaEntrada != null);

      if (data.ultimoFichaje?.tienda?.nombre) {
        setTiendaNombre(data.ultimoFichaje.tienda.nombre);
      }
    } catch {
      toast({ title: "Error", description: "No se pudo obtener el estado", variant: "destructive" });
    } finally {
      setLoadingEstado(false);
    }
  }, [toast]);

  // Fetch today's fichajes
  const fetchFichajesHoy = useCallback(async () => {
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const res = await fetch(`/api/fichajes?fecha=${hoy}`);
      if (!res.ok) return;
      const data: FichajeRegistro[] = await res.json();
      setFichajesHoy(data.slice(0, 8));
      // Pick store from latest fichaje
      const conTienda = data.find((f) => f.tienda?.nombre);
      if (conTienda?.tienda?.nombre) setTiendaNombre(conTienda.tienda.nombre);
    } catch {
      // silent
    }
  }, []);

  /**
   * El último cierre de su tienda, para poder revisar de verdad la caja y el
   * stock que le dejan. Se pide una vez al cargar la pantalla: no es urgente y
   * si falla no debe estorbar al fichaje.
   */
  const fetchCierreAnterior = useCallback(async () => {
    try {
      const res = await fetch("/api/cierre-turno/anterior");
      if (!res.ok) return;
      const data = (await res.json()) as {
        cierre: typeof cierreAnterior;
        fondoCaja: typeof fondoCaja;
      };
      setCierreAnterior(data.cierre ?? null);
      setFondoCaja(data.fondoCaja ?? null);
    } catch {
      /* sin conexión: el bloque simplemente no se pinta */
    }
  }, []);

  // Puntos de control configurados por la empresa (solo los activos).
  const fetchChecklist = useCallback(async () => {
    try {
      const res = await fetch("/api/checklist-fichaje");
      if (!res.ok) return;
      const data = (await res.json()) as { activo: boolean; items: ChecklistItem[] };
      setChecklistActivo(!!data.activo);
      setChecklistItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      // silent — sin checklist se ficha igual (RD 8/2019).
    }
  }, []);

  // ¿Se le ofrece el cierre de turno? Lo decide el servidor: plan del cliente,
  // rodaje del módulo y acceso anticipado. Un 402 (sin módulo contratado) o un
  // fallo dejan la pantalla como estaba, sin botón.
  const fetchAccesoCierre = useCallback(async () => {
    try {
      const res = await fetch("/api/cierre-turno/acceso");
      if (!res.ok) return;
      setAccesoCierre((await res.json()) as AccesoCierre);
    } catch {
      // silent — el fichaje no depende de esto.
    }
  }, []);

  useEffect(() => {
    fetchEstado();
    fetchFichajesHoy();
    void fetchChecklist();
    void fetchAccesoCierre();
    void fetchCierreAnterior();
  }, [fetchEstado, fetchFichajesHoy, fetchChecklist, fetchAccesoCierre, fetchCierreAnterior]);

  // Política de Face ID del tenant + ¿el usuario tiene template?
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/configuracion").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/face/status").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([cfg, st]) => {
      if (cancelled) return;
      setFaceRequired(!!cfg?.faceIdObligatorio);
      setFaceSavePhoto(!!cfg?.faceIdGuardarFoto);
      setHasFaceTemplate(!!st?.hasTemplate);
    });
    return () => { cancelled = true; };
  }, []);

  // Geolocation passive: comprueba el estado del permiso al cargar
  // y se actualiza si el usuario lo cambia desde la barra del navegador
  // (sin esto, "Ubicación no disponible" se quedaba pegada tras un
  // primer fallo aunque el usuario después permitiera el GPS).
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!navigator.permissions || !navigator.geolocation) return;
    let cancelled = false;

    const tryGeo = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          setLocationStatus("found");
        },
        () => {
          if (cancelled) return;
          setLocationStatus("denied");
        },
        { timeout: 10000, maximumAge: 30000 },
      );
    };

    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        const sync = () => {
          if (status.state === "granted") tryGeo();
          else if (status.state === "denied") setLocationStatus("denied");
          else setLocationStatus("idle");
        };
        sync();
        status.onchange = sync;
      })
      .catch(() => {
        // Safari < 16 / iOS no soporta permissions.query: ignorar.
      });

    return () => { cancelled = true; };
  }, []);

  // Geolocation
  const getLocation = useCallback((): Promise<{ lat: number; lon: number }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocalización no disponible en este dispositivo"));
        return;
      }
      setLocationStatus("checking");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          setCoords(loc);
          setLocationStatus("found");
          resolve(loc);
        },
        (err) => {
          setLocationStatus("denied");
          reject(new Error(err.message));
        },
        { timeout: 10000, maximumAge: 30000 }
      );
    });
  }, []);

  // Fichar action
  const handleFichar = useCallback(
    async (
      tipo: TipoFichaje,
      opts: {
        faceVerifyToken?: string;
        fotoSnapshot?: string;
        checklist?: RespuestaChecklist[];
        /**
         * El empleado ha aceptado que su fichaje se registre a la hora de su
         * turno (ticket 9e4c2f10). Sin esto, fichar fuera de horario devuelve
         * 409 y se le pregunta.
         */
        ajustarAlTurno?: boolean;
        /** Lo que haya escrito el empleado al justificar el ajuste. */
        nota?: string;
      } = {},
    ) => {
      setLoadingAction(tipo);
      try {
        let lat: number | undefined;
        let lon: number | undefined;

        try {
          const loc = await getLocation();
          lat = loc.lat;
          lon = loc.lon;
        } catch {
          // Location not available — proceed without it
          setLocationStatus("denied");
        }

        const res = await fetch("/api/fichajes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // `distancia` la calcula el servidor con las coordenadas
            // de la sede: un valor enviado desde aquí no sería auditable.
            tipo, latitud: lat, longitud: lon,
            ...(opts.faceVerifyToken ? { faceVerifyToken: opts.faceVerifyToken } : {}),
            ...(opts.fotoSnapshot ? { fotoSnapshot: opts.fotoSnapshot } : {}),
            ...(opts.checklist ? { checklist: opts.checklist } : {}),
            ...(opts.ajustarAlTurno ? { ajustarAlTurno: true } : {}),
            ...(opts.nota ? { nota: opts.nota } : {}),
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          // 409 fuera_de_sede: la sede exige presencia. No es un error del
          // empleado — se le ofrece registrarlo justificando el motivo.
          if (res.status === 409 && data.code === "fuera_de_sede" && lat != null && lon != null) {
            setMotivoFueraSede("");
            setFueraSede({
              tipo,
              mensaje: data.error,
              distancia: data.distancia,
              radio: data.radio,
              sede: data.sede?.nombre ?? "tu sede",
              lat,
              lon,
            });
            return;
          }
          // 409 fuera_de_horario: la empresa exige fichar dentro del turno. Se
          // le recuerda su horario y se le ofrece registrarlo a la hora del
          // turno; si acepta, se repite la llamada con `ajustarAlTurno` y queda
          // hecho, sin que nadie tenga que aprobar nada (ticket 9e4c2f10).
          if (res.status === 409 && data.code === "fuera_de_horario") {
            setMotivoFueraHorario("");
            setFueraHorario({
              tipo,
              motivo: data.motivo === "despues" ? "despues" : "antes",
              horaInicio: data.turno?.horaInicio ?? "",
              horaFin: data.turno?.horaFin ?? "",
              ajusteHora: data.ajusteHora ?? "",
              ajusteISO: data.ajuste ?? "",
              ajustable: data.ajustable !== false,
              margen: typeof data.margen === "number" ? data.margen : 0,
              mensaje: data.error ?? "",
            });
            return;
          }
          toast({
            title: "No se pudo registrar",
            description: data.error ?? "Error desconocido",
            variant: "destructive",
          });
          return;
        }

        // Update state optimistically
        switch (tipo) {
          case "ENTRADA":
            setEstado("trabajando");
            break;
          case "PAUSA":
            setEstado("en_pausa");
            break;
          case "VUELTA_PAUSA":
            setEstado("trabajando");
            break;
          case "SALIDA":
            setEstado("sin_fichar");
            break;
        }

        const labels: Record<TipoFichaje, string> = {
          ENTRADA: "Entrada registrada",
          PAUSA: "Pausa iniciada",
          VUELTA_PAUSA: "Vuelta de pausa registrada",
          SALIDA: "Salida registrada",
        };
        toast({ title: labels[tipo], description: formatHoraCorta(data.timestamp) });

        await Promise.all([fetchEstado(), fetchFichajesHoy()]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        toast({ title: "Error", description: message, variant: "destructive" });
      } finally {
        setLoadingAction(null);
      }
    },
    [getLocation, fetchEstado, fetchFichajesHoy, fetchChecklist, toast]
  );

  // Envía el intento rechazado como SolicitudFichaje "fuera_sede": el
  // fichaje no se pierde, queda pendiente de que un administrador lo apruebe.
  const enviarSolicitudFueraSede = useCallback(async () => {
    if (!fueraSede) return;
    const motivo = motivoFueraSede.trim();
    if (motivo.length < 3) {
      toast({
        title: "Falta el motivo",
        description: "Explica brevemente por qué fichas fuera de la sede (mínimo 3 caracteres).",
        variant: "destructive",
      });
      return;
    }
    setEnviandoFueraSede(true);
    try {
      const res = await fetch("/api/solicitudes-fichaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clase: "fuera_sede",
          tipo: fueraSede.tipo,
          fechaHora: new Date().toISOString(),
          motivo,
          latitud: fueraSede.lat,
          longitud: fueraSede.lon,
          distancia: fueraSede.distancia,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se pudo enviar",
          description: data.error ?? "Error desconocido",
          variant: "destructive",
        });
        return;
      }
      setFueraSede(null);
      toast({
        title: "Enviado para aprobación",
        description: "Tu responsable revisará el fichaje. No hace falta que lo repitas.",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "destructive",
      });
    } finally {
      setEnviandoFueraSede(false);
    }
  }, [fueraSede, motivoFueraSede, toast]);

  /**
   * Registra el fichaje con la hora de su turno, después de que el empleado lo
   * acepte en la ventana emergente (ticket 9e4c2f10).
   *
   * Antes esto abría una solicitud que tenía que aprobar un responsable, y al
   * cliente le llegaban decenas al día. Ahora se registra en el momento: el
   * servidor recalcula la hora desde el cuadrante —no se manda desde aquí, que
   * no sería auditable— y deja escrito en el fichaje a qué hora se pulsó de
   * verdad, para que administración lo pueda repasar después.
   *
   * El motivo que escriba se guarda como nota del fichaje. No se le exige: el
   * fichaje no puede quedar bloqueado por un texto (RD 8/2019).
   */
  const registrarAjustadoAlTurno = useCallback(async () => {
    if (!fueraHorario) return;
    const tipo = fueraHorario.tipo;
    const motivo = motivoFueraHorario.trim();
    setEnviandoFueraHorario(true);
    try {
      setFueraHorario(null);
      await handleFichar(tipo, { ajustarAlTurno: true, ...(motivo ? { nota: motivo } : {}) });
    } finally {
      setEnviandoFueraHorario(false);
    }
  }, [fueraHorario, motivoFueraHorario, handleFichar]);

  // Puntos de control activos para un tipo de fichaje concreto.
  const checksDe = useCallback(
    (tipo: TipoFichaje): ChecklistItem[] =>
      checklistActivo
        ? checklistItems
            .filter((i) => i.tipo === tipo)
            .sort((a, b) => a.orden - b.orden)
        : [],
    [checklistActivo, checklistItems],
  );

  // Tras el checklist (si lo hay), decide si pedir Face ID antes de fichar.
  const continuarFichaje = useCallback(
    (tipo: TipoFichaje, checklist?: RespuestaChecklist[]) => {
      if (faceRequired && hasFaceTemplate) {
        setFaceError(null);
        setRespuestasChecklist(checklist ?? null);
        setPendingFaceTipo(tipo);
        return;
      }
      void handleFichar(tipo, checklist ? { checklist } : {});
    },
    [faceRequired, hasFaceTemplate, handleFichar],
  );

  // Wrapper público: primero el checklist de la empresa, luego Face ID.
  const fichar = useCallback(
    (tipo: TipoFichaje) => {
      if (checksDe(tipo).length > 0) {
        setChecksMarcados({});
        setPendingChecklistTipo(tipo);
        return;
      }
      continuarFichaje(tipo);
    },
    [checksDe, continuarFichaje],
  );

  // Confirma el checklist y sigue con el fichaje. Se envía el estado real de
  // cada punto: los que no haya marcado viajan como `marcado: false` y quedan
  // registrados así. No se le impide fichar por dejar alguno sin marcar —el
  // registro de jornada no puede bloquearse (RD 8/2019)—, pero su responsable
  // ve qué no confirmó.
  const confirmarChecklist = useCallback(() => {
    const tipo = pendingChecklistTipo;
    if (!tipo) return;
    const items = checksDe(tipo);
    setPendingChecklistTipo(null);
    continuarFichaje(
      tipo,
      items.map((i) => ({ itemId: i.id, marcado: Boolean(checksMarcados[i.id]) })),
    );
  }, [pendingChecklistTipo, checksDe, checksMarcados, continuarFichaje]);

  const handleFaceCapture = useCallback(
    async (embedding: number[], snapshot?: string) => {
      if (!pendingFaceTipo) return;
      setFaceVerifying(true);
      setFaceError(null);
      try {
        const r = await fetch("/api/face/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embedding }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
        if (!data.match) {
          throw new Error("El rostro no coincide con el registrado. Colócate de frente, con buena luz, y vuelve a intentarlo.");
        }
        const tipo = pendingFaceTipo;
        setPendingFaceTipo(null);
        if (typeof data.faceVerifyToken !== "string") {
          throw new Error("El servidor no emitió token de verificación.");
        }
        await handleFichar(tipo, {
          faceVerifyToken: data.faceVerifyToken,
          fotoSnapshot: snapshot,
          ...(respuestasChecklist ? { checklist: respuestasChecklist } : {}),
        });
        setRespuestasChecklist(null);
      } catch (e) {
        setFaceError(e instanceof Error ? e.message : "Error verificando rostro");
      } finally {
        setFaceVerifying(false);
      }
    },
    [pendingFaceTipo, respuestasChecklist, handleFichar],
  );

  // ── Render helpers ────────────────────────────────────────────────────────

  function EstadoBadge() {
    if (estado === "trabajando") {
      return (
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
          <span className="text-emerald-600 font-semibold text-lg">Trabajando</span>
        </div>
      );
    }
    if (estado === "en_pausa") {
      return (
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
          </span>
          <span className="text-amber-600 font-semibold text-lg">En pausa</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <span className="relative flex h-3 w-3">
          <span className="relative inline-flex rounded-full h-3 w-3 bg-slate-400" />
        </span>
        <span className="text-slate-500 font-semibold text-lg">Sin fichar</span>
      </div>
    );
  }

  function LocationIndicator() {
    if (locationStatus === "idle") return null;
    const configs = {
      checking: { icon: <Loader2 className="h-4 w-4 animate-spin text-sky-500" />, text: "Obteniendo ubicación…", cls: "text-sky-600" },
      found: { icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, text: "Ubicación confirmada", cls: "text-emerald-600" },
      denied: { icon: <MapPinOff className="h-4 w-4 text-amber-500" />, text: "Ubicación no disponible", cls: "text-amber-600" },
      outside: { icon: <XCircle className="h-4 w-4 text-rose-500" />, text: "Fuera del rango de la sede", cls: "text-rose-600" },
    };
    const c = configs[locationStatus];
    return (
      <div className={cn("flex items-center gap-1.5 text-sm", c.cls)}>
        {c.icon}
        <span>{c.text}</span>
      </div>
    );
  }

  function DeviceGatedFichaje({ children }: { children: React.ReactNode }) {
    // Gate por device + feature según ADR-004 §11.4 + plan A.3.
    // CORE-safe: el fichaje sigue accesible — desde otro device.
    const device = useDeviceType();
    const { data: features, loading: featuresLoading } = useFeatures();
    if (featuresLoading || device === "unknown") {
      return <>{children}</>; // optimistic — evita parpadeo en SSR/primer paint
    }
    const required = deviceFichajeFeature(device);
    if (required && features && features.booleans[required] === false) {
      return (
        <div className="space-y-3">
          <UpsellCTA feature={required} />
          <p className="text-xs text-muted-foreground text-center">
            Con el plan actual, el fichaje no está habilitado desde{" "}
            {device === "mobile" ? "el móvil" : "la tablet"}. Ficha desde el PC o el kiosko
            del centro de trabajo, o pídele a tu administrador que lo active.
          </p>
        </div>
      );
    }
    return <>{children}</>;
  }

  function ActionButtons() {
    const isLoading = loadingAction !== null;

    // Face ID obligatorio + el usuario no tiene rostro registrado.
    // No tiene sentido renderizar los botones; le obligamos a enrolar.
    if (faceRequired && hasFaceTemplate === false) {
      return (
        <div className="w-full max-w-md mx-auto rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center space-y-3">
          <ScanFace className="h-8 w-8 text-amber-600 mx-auto" />
          <h3 className="font-semibold text-amber-900">Face ID requerido</h3>
          <p className="text-sm text-amber-800">
            Tu empresa exige reconocimiento facial para fichar. Registra tu rostro
            (solo se guarda un vector cifrado, nunca tu foto) y vuelve aquí.
          </p>
          <Link
            href="/empleado/face-id"
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 px-4 py-2 text-sm font-semibold text-white"
          >
            <ScanFace className="h-4 w-4" />
            Registrar Face ID
          </Link>
        </div>
      );
    }

    if (estado === "sin_fichar") {
      return (
        <button
          onClick={() => fichar("ENTRADA")}
          disabled={isLoading}
          className={cn(
            "w-full max-w-xs mx-auto flex items-center justify-center gap-3 rounded-2xl py-6 text-white text-2xl font-bold shadow-lg transition-all duration-200",
            "bg-emerald-500 hover:bg-emerald-600 active:scale-95",
            isLoading && "opacity-60 cursor-not-allowed"
          )}
        >
          {loadingAction === "ENTRADA" ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : (
            <LogIn className="h-7 w-7" />
          )}
          ENTRADA
        </button>
      );
    }

    if (estado === "trabajando") {
      return (
        <div className="flex gap-4 w-full max-w-sm mx-auto">
          <button
            onClick={() => fichar("PAUSA")}
            disabled={isLoading}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl py-5 text-white font-bold shadow-lg transition-all duration-200",
              "bg-amber-500 hover:bg-amber-600 active:scale-95",
              isLoading && "opacity-60 cursor-not-allowed"
            )}
          >
            {loadingAction === "PAUSA" ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Coffee className="h-6 w-6" />
            )}
            <span className="text-lg">PAUSA</span>
          </button>
          <button
            onClick={() => fichar("SALIDA")}
            disabled={isLoading}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl py-5 text-white font-bold shadow-lg transition-all duration-200",
              "bg-rose-500 hover:bg-rose-600 active:scale-95",
              isLoading && "opacity-60 cursor-not-allowed"
            )}
          >
            {loadingAction === "SALIDA" ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <LogOut className="h-6 w-6" />
            )}
            <span className="text-lg">SALIDA</span>
          </button>
        </div>
      );
    }

    // en_pausa
    return (
      <div className="flex gap-4 w-full max-w-sm mx-auto">
        <button
          onClick={() => fichar("VUELTA_PAUSA")}
          disabled={isLoading}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl py-5 text-white font-bold shadow-lg transition-all duration-200",
            "bg-emerald-500 hover:bg-emerald-600 active:scale-95",
            isLoading && "opacity-60 cursor-not-allowed"
          )}
        >
          {loadingAction === "VUELTA_PAUSA" ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <RotateCcw className="h-6 w-6" />
          )}
          <span className="text-lg">VOLVER</span>
        </button>
        <button
          onClick={() => fichar("SALIDA")}
          disabled={isLoading}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl py-5 text-white font-bold shadow-lg transition-all duration-200",
            "bg-rose-500 hover:bg-rose-600 active:scale-95",
            isLoading && "opacity-60 cursor-not-allowed"
          )}
        >
          {loadingAction === "SALIDA" ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <LogOut className="h-6 w-6" />
          )}
          <span className="text-lg">SALIDA</span>
        </button>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  if (loadingEstado) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4 text-slate-500">
          <Loader2 className="h-10 w-10 animate-spin text-[var(--primary)]" />
          <p className="text-sm">Cargando estado de fichaje…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Main clock card */}
      <Card
        className={cn(
          "overflow-hidden border-2 transition-colors duration-500",
          estado === "trabajando" && "border-emerald-200",
          estado === "en_pausa" && "border-amber-200",
          estado === "sin_fichar" && "border-slate-200"
        )}
      >
        {/* Gradient accent bar */}
        <div
          className={cn(
            "h-2 w-full transition-colors duration-500",
            estado === "trabajando" && "bg-emerald-500",
            estado === "en_pausa" && "bg-amber-500",
            estado === "sin_fichar" && "bg-[var(--primary)]"
          )}
        />

        <CardContent className="p-8 space-y-6">
          {/* Date */}
          <div className="text-center">
            <p className="text-slate-500 text-sm font-medium tracking-wide uppercase">
              {formatFechaLarga(now)}
            </p>
          </div>

          {/* Clock */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center gap-2 mb-1">
              <Clock className="h-6 w-6 text-[var(--primary)]" />
            </div>
            <p className="text-5xl sm:text-6xl lg:text-7xl font-mono font-bold tracking-tight text-slate-900 tabular-nums">
              {formatHora(now)}
            </p>
          </div>

          {/* Estado + hours */}
          <div className="flex items-center justify-between px-2">
            <EstadoBadge />
            {minutosHoy > 0 && (
              <span className="text-sm text-slate-500 font-medium">
                {minutosATexto(minutosHoy)}
              </span>
            )}
          </div>

          {/* Tienda */}
          {tiendaNombre && (
            <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 rounded-md px-3 py-2">
              <Store className="h-4 w-4 text-[var(--primary)] shrink-0" />
              <span>{tiendaNombre}</span>
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-slate-200" />

          {/* Action buttons (con gate por device) */}
          <DeviceGatedFichaje>
            <ActionButtons />
          </DeviceGatedFichaje>

          {/* Location status */}
          <div className="flex justify-center">
            <LocationIndicator />
          </div>
        </CardContent>
      </Card>

      {/* Cierre de turno — solo con el módulo contratado, para quien ya lo
          tiene abierto y una vez ha fichado la entrada: antes de empezar la
          jornada no hay ventas ni caja que cerrar. Es un acceso, no un
          requisito: no condiciona el fichaje (RD 8/2019). */}
      {accesoCierre?.visible && entradaHoy && (
        <Card>
          <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-[var(--primary)] shrink-0" />
                Cierre de turno
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {accesoCierre.cerrado
                  ? "Ya has cerrado tu turno de hoy. Puedes repasar lo que registraste."
                  : accesoCierre.empezado
                    ? "Tienes el cierre de hoy empezado. Continúa donde lo dejaste."
                    : "Registra las ventas del día, mira cómo vas de objetivos y cierra tu caja."}
              </p>
            </div>
            <Link
              href="/empleado/cierre-turno"
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg px-5 h-11 text-sm font-semibold shrink-0 transition-colors",
                accesoCierre.cerrado
                  ? "border border-slate-200 text-slate-700 hover:bg-slate-50"
                  : "bg-[var(--primary)] hover:bg-[var(--primary-dark)] text-white",
              )}
            >
              {accesoCierre.cerrado
                ? "Ver mi cierre"
                : accesoCierre.empezado
                  ? "Continuar el cierre"
                  : "Cierre de turno"}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Today's fichajes list */}
      {fichajesHoy.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-sm text-slate-500 uppercase tracking-wide">
                Registros de hoy
              </h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {fichajesHoy.map((f) => (
                <li key={f.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        tipoColor(f.tipo)
                      )}
                    >
                      {tipoLabel(f.tipo)}
                    </span>
                  </div>
                  <span className="font-mono text-sm font-medium text-slate-900">
                    {formatHoraCorta(f.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {fueraSede && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between">
              <h2 className="font-semibold text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5 text-amber-600" />
                Estás fuera de tu sede
              </h2>
              <button
                onClick={() => setFueraSede(null)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Cerrar"
                disabled={enviandoFueraSede}
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Estás a <strong>{fueraSede.distancia} m</strong> de {fueraSede.sede} y tu empresa exige
              fichar desde el puesto de trabajo (máximo {fueraSede.radio} m). Puedes registrarlo de
              todas formas explicando el motivo: quedará pendiente de aprobación por tu responsable.
            </p>
            <div>
              <label htmlFor="motivo-fuera-sede" className="text-sm font-medium text-slate-800">
                Motivo
              </label>
              <textarea
                id="motivo-fuera-sede"
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                rows={3}
                value={motivoFueraSede}
                onChange={(e) => setMotivoFueraSede(e.target.value)}
                placeholder="Ej.: reparto en casa de un cliente, visita a proveedor…"
                disabled={enviandoFueraSede}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setFueraSede(null)} disabled={enviandoFueraSede}>
                Cancelar
              </Button>
              <Button onClick={() => void enviarSolicitudFueraSede()} disabled={enviandoFueraSede}>
                {enviandoFueraSede ? "Enviando…" : "Enviar para aprobación"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {fueraHorario && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between">
              <h2 className="font-semibold text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-600" />
                {fueraHorario.motivo === "antes"
                  ? "Tu turno todavía no ha empezado"
                  : "Tu turno ya ha terminado"}
              </h2>
              <button
                onClick={() => setFueraHorario(null)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Cerrar"
                disabled={enviandoFueraHorario}
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            {/* Nunca "tu empresa no permite fichar": registrar la jornada es un
                derecho del trabajador, decirlo así suena a castigo y encima da a
                entender lo contrario de lo que hace el sistema, que registra la
                jornada igual (ticket 9a3f27d0). Se explica cómo está hecho el
                fichaje —un margen a cada lado del turno— y qué puede hacer. */}
            <p className="text-sm text-muted-foreground">
              Tu turno de hoy es de <strong>{fueraHorario.horaInicio}</strong> a{" "}
              <strong>{fueraHorario.horaFin}</strong>.
              {fueraHorario.margen > 0 && (
                <>
                  {" "}
                  El fichaje está pensado para hacerse como mucho{" "}
                  <strong>
                    {fueraHorario.margen} minuto{fueraHorario.margen === 1 ? "" : "s"}
                  </strong>{" "}
                  antes de entrar o {fueraHorario.margen} después de salir.
                </>
              )}
            </p>
            {fueraHorario.ajustable ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Puedes registrar tu {tipoLabel(fueraHorario.tipo).toLowerCase()} a las{" "}
                  <strong>{fueraHorario.ajusteHora}</strong>, la hora de tu turno. Se guarda al
                  momento y queda anotada la hora a la que has fichado de verdad.
                </p>
                <p className="text-sm text-muted-foreground">
                  Si has {fueraHorario.motivo === "antes" ? "empezado" : "terminado"} a otra
                  hora, díselo a tu responsable: el tiempo que trabajas se registra siempre.
                </p>
              </>
            ) : (
              /* Cruce sin hora con la que cuadrar —entrar después del cierre o
                 salir antes de empezar—: no se inventa un ajuste, se le dice
                 dónde pedirlo (ticket b7d3e5a9). */
              <p className="text-sm text-muted-foreground">
                Esta vez no cuadra con el horario de hoy. Pídelo en{" "}
                <a href="/empleado/mis-fichajes" className="underline font-medium">
                  Mis Fichajes
                </a>{" "}
                con la hora real y administración lo registra: el tiempo que trabajas se
                registra siempre.
              </p>
            )}
            {fueraHorario.ajustable && (
            <div>
              <label htmlFor="motivo-fuera-horario" className="text-sm font-medium text-slate-800">
                Motivo <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <textarea
                id="motivo-fuera-horario"
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                rows={3}
                value={motivoFueraHorario}
                onChange={(e) => setMotivoFueraHorario(e.target.value)}
                placeholder="Ej.: he llegado antes para abrir la tienda, me he quedado terminando una venta…"
                disabled={enviandoFueraHorario}
              />
            </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setFueraHorario(null)}
                disabled={enviandoFueraHorario}
              >
                {fueraHorario.ajustable ? "Cancelar" : "Entendido"}
              </Button>
              {fueraHorario.ajustable && (
                <Button
                  onClick={() => void registrarAjustadoAlTurno()}
                  disabled={enviandoFueraHorario}
                >
                  {enviandoFueraHorario
                    ? "Registrando…"
                    : `Registrar a las ${fueraHorario.ajusteHora}`}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {pendingChecklistTipo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between">
              <h2 className="font-semibold text-lg flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-[var(--primary)]" />
                Antes de fichar la {pendingChecklistTipo === "SALIDA" ? "salida" : "entrada"}
              </h2>
              <button
                onClick={() => setPendingChecklistTipo(null)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Cerrar"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Marca cada comprobación para confirmar que la has hecho. Quedan
              registradas junto a tu fichaje.
            </p>

            {/* Lo que dejó el turno anterior (ticket 2e6b91f4). Va aquí y no en
                otra pantalla porque es justo el momento en que se le pide
                revisar la caja y el stock: si hay que ir a buscarlo, no se
                revisa. Solo en la entrada — al salir, lo que cuenta es lo que
                deja él. */}
            {pendingChecklistTipo === "ENTRADA" && (cierreAnterior || fondoCaja) && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 space-y-2">
                <p className="text-sm font-semibold text-sky-900">
                  Lo que te deja el turno anterior
                </p>

                {/* Fondo de caja registrado: es contra lo que cuenta el cajón al
                    abrir (ticket 7ab2c5d9). Va primero porque es lo primero que
                    hace. */}
                {fondoCaja && (
                  <div className="rounded-md border border-sky-300 bg-white px-2.5 py-2">
                    {fondoCaja.incidencia ? (
                      <>
                        <p className="text-sm font-semibold text-amber-700">
                          Caja pendiente de aclarar
                        </p>
                        <p className="text-xs text-amber-800 mt-0.5">{fondoCaja.incidencia}</p>
                      </>
                    ) : (
                      <p className="text-sm text-sky-900">
                        Efectivo acumulado que debería haber en el cajón:{" "}
                        <strong className="tabular-nums">{eur(fondoCaja.importe ?? 0)}</strong>
                        <span className="block text-xs text-sky-800 mt-0.5">
                          Sin contar el fondo de cambio. Si no cuadra, dilo en tu cierre.
                        </span>
                      </p>
                    )}
                    <p className="text-xs text-sky-700 mt-0.5">
                      Registrado a{" "}
                      {new Date(`${fondoCaja.fecha}T00:00:00`).toLocaleDateString("es-ES", {
                        day: "numeric",
                        month: "long",
                      })}
                      {fondoCaja.sede ? ` · ${fondoCaja.sede}` : ""}
                    </p>
                  </div>
                )}
                {/* El cierre anterior puede no existir (tienda nueva, primer
                    día) y aun así haber fondo registrado. */}
                {cierreAnterior && (
                  <>
                <p className="text-xs text-sky-800">
                  {cierreAnterior.quien} ·{" "}
                  {new Date(`${cierreAnterior.fecha}T00:00:00`).toLocaleDateString("es-ES", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                  {cierreAnterior.sede ? ` · ${cierreAnterior.sede}` : ""}
                </p>
                {cierreAnterior.caja ? (
                  <>
                    <div className="flex gap-4 text-sm">
                      <span className="text-sky-900">
                        Efectivo:{" "}
                        <strong className="tabular-nums">
                          {eur(cierreAnterior.caja.efectivo)}
                        </strong>
                      </span>
                      <span className="text-sky-900">
                        Tarjeta:{" "}
                        <strong className="tabular-nums">
                          {eur(cierreAnterior.caja.tarjeta)}
                        </strong>
                      </span>
                    </div>
                    {cierreAnterior.caja.adjuntos.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {cierreAnterior.caja.adjuntos.map((a) => (
                          <a
                            key={a.id}
                            href={`/api/cierre-turno/adjuntos/${a.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-2 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100"
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                            {a.tipo === "stock" ? "Stock" : a.tipo === "tpv" ? "TPV" : a.tipo === "gasto" ? "Gasto" : a.nombre}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-sky-700">
                        No dejó adjunto el Excel del stock ni el comprobante del TPV.
                      </p>
                    )}
                    {!cierreAnterior.caja.confirmada && (
                      <p className="text-xs text-amber-700">
                        Su cierre de caja quedó sin confirmar.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-sky-700">No dejó cierre de caja.</p>
                )}
                {cierreAnterior.incidencia && (
                  <p className="text-xs text-sky-900 border-t border-sky-200 pt-2">
                    <strong>Incidencia que dejó:</strong> {cierreAnterior.incidencia}
                  </p>
                )}
                  </>
                )}
              </div>
            )}
            <ul className="space-y-2">
              {checksDe(pendingChecklistTipo).map((item) => (
                <li key={item.id}>
                  <label
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-sm cursor-pointer transition-colors",
                      checksMarcados[item.id]
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : "border-slate-200 hover:bg-slate-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
                      checked={!!checksMarcados[item.id]}
                      onChange={(e) =>
                        setChecksMarcados((prev) => ({ ...prev, [item.id]: e.target.checked }))
                      }
                    />
                    <span>{item.texto}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setPendingChecklistTipo(null)}>
                Cancelar
              </Button>
              {/* Sin `disabled`: dejar puntos sin marcar no puede impedir el
                  fichaje (RD 8/2019). El texto avisa de lo que se va a
                  registrar como no confirmado. */}
              <Button onClick={confirmarChecklist}>
                {(() => {
                  const faltan = checksDe(pendingChecklistTipo).filter((i) => !checksMarcados[i.id]).length;
                  return faltan === 0
                    ? "Confirmar y fichar"
                    : `Fichar con ${faltan} sin marcar`;
                })()}
              </Button>
            </div>
          </div>
        </div>
      )}

      {pendingFaceTipo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between">
              <h2 className="font-semibold text-lg flex items-center gap-2">
                <ScanFace className="h-5 w-5 text-[var(--primary)]" />
                Verifica tu identidad
              </h2>
              <button
                onClick={() => { setPendingFaceTipo(null); setFaceError(null); }}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Cerrar"
                disabled={faceVerifying}
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Tu empresa exige Face ID para fichar. Captura tu rostro para confirmar la acción <strong>{pendingFaceTipo}</strong>.
            </p>
            <FaceCapture
              cta="Verificar y fichar"
              pending={faceVerifying}
              captureSnapshot={faceSavePhoto}
              onCapture={(emb, snap) => void handleFaceCapture(emb, snap)}
            />
            {faceSavePhoto && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Tu empresa guarda una foto cifrada del momento del fichaje para auditoría.
                Solo accede personal autorizado.
              </p>
            )}
            {faceError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {faceError}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
