"use client";

/**
 * Asistente diario de cierre de turno (4 pasos), con guardado real.
 *
 * Cada comercial cierra SU caja (decidido con el cliente el 2026-07-30): es lo
 * que permite atribuir un descuadre a una persona. El borrador se guarda al
 * avanzar de paso, así que dejarlo a media faena no pierde el trabajo.
 *
 * Confirmar la caja es irreversible para el comercial: a partir de ahí solo un
 * administrador puede corregirla, y queda registrado. Se avisa antes.
 *
 * El asistente NO condiciona el fichaje: se puede fichar la salida sin haber
 * cerrado (RD 8/2019, misma regla que el geofencing y el checklist de fichaje).
 *
 * Los domingos, a quien cierra la tienda le sale un paso más: el **arqueo
 * semanal** (ticket 3b7e05d1). Cuenta el efectivo acumulado, lo mete en un sobre
 * y lo declara; sin eso no puede cerrar el turno. El importe se pide a ciegas —
 * la cifra esperada se le enseña DESPUÉS de guardar—: si la ve antes, la teclea
 * sin contar y el arqueo deja de detectar descuadres.
 *
 * Lo primero que se le pregunta es en qué tienda ha trabajado hoy, con la
 * respuesta ya elegida (ticket 8c05f3e1): el cierre usaba la sede de su ficha, y
 * quien no tiene ninguna —un correturnos— se encontraba los objetivos de tienda
 * y la caja en blanco con un "no tienes sede asignada", estando de hecho en una.
 *
 * Vive en su propia pantalla (`/empleado/cierre-turno`) y, con `enDialogo`,
 * también dentro de una ventana emergente (ver `BotonCierreDia`): es el mismo
 * asistente, sin su cabecera de página porque el título lo pone el diálogo.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, PackageOpen, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pasosDelCierre, type PasoCierre } from "@/lib/cierre-turno/core";
import type { MotivoSede } from "@/lib/cierre-turno/sede-del-dia";
import {
  agruparCatalogo,
  aplanarCatalogo,
  articulosConNombreAmbiguo,
} from "@/lib/cierre-turno/catalogo";

interface Articulo {
  id: string;
  nombre: string;
  categoria: string | null;
  /** Segundo nivel dentro de la categoría ("Pospago" dentro de "Telefonía"). */
  subcategoria: string | null;
}

type TipoAdjuntoUI = "stock" | "tpv";

interface AdjuntoCierre {
  id: string;
  tipo: string;
  nombre: string;
  tamañoBytes: number;
}

/** Un objetivo del mes con su desglose por grupo de productos. */
interface BloqueProgreso {
  vendido: number;
  objetivo: number | null;
  consecucion: number | null;
  /** Una fila por grupo del catálogo, tenga objetivo o no. */
  grupos: {
    grupo: string;
    vendido: number;
    objetivo: number | null;
    consecucion: number | null;
  }[];
}

/** Lo que devuelve `/api/cierre-turno/progreso` para el paso 2. */
interface Progreso {
  mes: string;
  preciosActivos: boolean;
  /** Nombre de la tienda en la que ficha. null si no tiene sede asignada. */
  sedeNombre: string | null;
  propio: BloqueProgreso;
  sede: BloqueProgreso | null;
  /** El objetivo que el operador impone a su sede (ticket 5d8b21c7). */
  sedeTmt: BloqueProgreso | null;
  porArticulo: {
    articuloId: string;
    nombre: string;
    vendido: number;
    objetivo: number | null;
    /** null cuando no hay objetivo del artículo: no hay nada que cumplir. */
    consecucion: number | null;
    importe: number | null;
    /** false = lo vendido de este artículo no suma en los objetivos. */
    cuentaParaObjetivos: boolean;
    /**
     * Productos del catálogo que suma la fila: los que se llaman igual van
     * juntos aunque estén en categorías distintas (ticket 7dd7ac00).
     */
    productos: number;
  }[];
}

const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

/**
 * Verde al llegar al objetivo, rojo mientras no se llegue. Sin tramo ámbar a
 * propósito, igual que la parrilla de definición y el seguimiento
 * (`objetivos-venta.tsx`): un ámbar al 95 % se lee como "va bien" cuando el
 * objetivo sigue sin cumplirse.
 */
const colorPct = (v: number | null) =>
  v === null ? "text-slate-400" : v >= 100 ? "text-emerald-700 font-semibold" : "text-rose-600";

/**
 * Color de cada cuadro del paso 2. Es lo que permite decir "mira el ámbar" sin
 * leer el título: el mismo comercial mira los tres cuadros todos los días.
 *
 *  - `propio`: el color de la marca, porque es el suyo y es el primero.
 *  - `sede`: azul, el mismo que ya usa el módulo para lo de la tienda.
 *  - `tmt`: ámbar, igual que la tabla del operador en la parrilla de
 *    administración (`objetivos-venta.tsx`), que es de donde salen sus cifras.
 */
const TONOS = {
  propio: {
    borde: "border-[var(--primary)]/40",
    fondo: "bg-[var(--primary)]/5",
    texto: "text-[var(--primary)]",
    barra: "primary" as const,
  },
  sede: {
    borde: "border-sky-300",
    fondo: "bg-sky-50",
    texto: "text-sky-700",
    barra: "primary" as const,
  },
  tmt: {
    borde: "border-amber-300",
    fondo: "bg-amber-50",
    texto: "text-amber-700",
    barra: "warning" as const,
  },
};

/**
 * Un objetivo del mes: el porcentaje grande con su barra y, debajo, una línea
 * por grupo de productos.
 *
 * Los grupos salen TODOS, con objetivo o sin él: enseñar solo lo que ha vendido
 * escondía justo lo que va a cero, que es lo que hay que mirar antes de cerrar
 * el turno. El que no tiene objetivo se pinta apagado y sin barra —no hay nada
 * que cumplir— pero con lo vendido a la vista.
 */
/** Por qué se le propone esa tienda. Se lo decimos: leerlo cambia la respuesta. */
const PORQUE_SEDE: Record<MotivoSede, string> = {
  ubicacion: "Es la tienda donde has fichado hoy.",
  turno: "Es la tienda de tu turno de hoy en el cuadrante.",
  ficha: "Es tu tienda habitual.",
  ninguna: "No sabemos dónde estás hoy: dínoslo tú.",
};

function CuadroObjetivo({
  titulo,
  subtitulo,
  tono,
  dato,
}: {
  titulo: string;
  subtitulo: string;
  tono: (typeof TONOS)[keyof typeof TONOS];
  dato: BloqueProgreso | null;
}) {
  // Sin sede asignada no hay tienda de la que hablar, y sin objetivo tampoco
  // hay porcentaje: en los dos casos se dice, en vez de pintar un 0 %.
  const pct = dato?.consecucion ?? null;
  return (
    <div className={`rounded-lg border ${tono.borde} ${tono.fondo} p-3`}>
      <p className={`text-sm font-semibold ${tono.texto}`}>{titulo}</p>
      <p className="text-xs text-slate-500 mt-0.5">{subtitulo}</p>

      {dato === null ? (
        <p className="text-sm text-slate-400 mt-3">No tienes sede asignada.</p>
      ) : (
        <>
          <div className="mt-3 flex items-end justify-between gap-2">
            <span className={`text-3xl font-bold tabular-nums ${colorPct(pct)}`}>
              {pct === null ? "—" : `${pct} %`}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {dato.vendido} / {dato.objetivo ?? "—"} uds
            </span>
          </div>
          {pct !== null && (
            <ProgressBar
              value={pct}
              tone={pct >= 100 ? "success" : "danger"}
              size="md"
              className="mt-2"
            />
          )}
          {dato.objetivo === null && (
            <p className="text-xs text-slate-400 mt-2">Sin objetivo fijado este mes.</p>
          )}

          {dato.grupos.length > 0 && (
            <ul className="mt-3 space-y-2 border-t border-slate-200/70 pt-3">
              {dato.grupos.map((g) => (
                <li key={g.grupo}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700">{g.grupo}</span>
                    <span className="text-xs tabular-nums text-slate-500">
                      {g.vendido}
                      {g.objetivo === null ? "" : ` / ${g.objetivo}`}
                      {g.consecucion === null ? "" : ` · `}
                      {g.consecucion === null ? (
                        ""
                      ) : (
                        <span className={colorPct(g.consecucion)}>{g.consecucion} %</span>
                      )}
                    </span>
                  </div>
                  {g.consecucion !== null && (
                    <ProgressBar
                      value={g.consecucion}
                      tone={g.consecucion >= 100 ? "success" : "danger"}
                      className="mt-1"
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Color de cada bloque de categoría al registrar las ventas (ticket 41c7d0e2).
 *
 * El cliente lo pidió así: su equipo se equivocaba de bloque, porque los mismos
 * productos existen en Particular y en Empresa y la cabecera era una línea gris
 * como cualquier otra. Con color fuerte, cabecera pegada arriba mientras se
 * rellena y la categoría repetida en las filas que se llaman igual, meter la
 * cifra en el sitio equivocado cuesta bastante más.
 *
 * Los colores van por POSICIÓN, no por nombre: cada cliente tiene sus
 * categorías, y "Particular"/"Empresa" son las de este.
 */
const COLOR_CATEGORIA = [
  { fondo: "bg-sky-600", chip: "bg-sky-100 text-sky-800", borde: "border-l-sky-500" },
  { fondo: "bg-violet-600", chip: "bg-violet-100 text-violet-800", borde: "border-l-violet-500" },
  { fondo: "bg-teal-600", chip: "bg-teal-100 text-teal-800", borde: "border-l-teal-500" },
  { fondo: "bg-amber-600", chip: "bg-amber-100 text-amber-800", borde: "border-l-amber-500" },
  { fondo: "bg-rose-600", chip: "bg-rose-100 text-rose-800", borde: "border-l-rose-500" },
];

const TITULOS: Record<PasoCierre, string> = {
  ventas: "Ventas del día",
  resultados: "Cómo vas",
  caja: "Cierre de caja",
  arqueo: "Arqueo semanal",
  incidencias: "Incidencias",
};

export function AsistenteCierre({
  enDialogo = false,
  onGuardado,
}: {
  /** Dentro de una ventana emergente: sin cabecera de página ni ancho propio. */
  enDialogo?: boolean;
  /** Tras cada guardado con éxito, para que quien lo abrió refresque sus datos. */
  onGuardado?: () => void;
}) {
  const [paso, setPaso] = useState<PasoCierre>("ventas");
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [catalogoVacio, setCatalogoVacio] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [detalle, setDetalle] = useState("");
  const [efectivo, setEfectivo] = useState("");
  const [tarjeta, setTarjeta] = useState("");
  /**
   * Su sede vende, pero el dinero no es nuestro: lo liquida el tercero (ticket
   * 9d4e17c2). El paso de caja no pide importes; pide el stock y los tickets de
   * las ventas facturadas.
   */
  const [sedeSinEfectivo, setSedeSinEfectivo] = useState(false);
  const [hayIncidencia, setHayIncidencia] = useState<boolean | null>(null);
  const [incidencia, setIncidencia] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [adjuntos, setAdjuntos] = useState<AdjuntoCierre[]>([]);
  const [subiendo, setSubiendo] = useState<TipoAdjuntoUI | null>(null);
  const inputStock = useRef<HTMLInputElement>(null);
  const inputTpv = useRef<HTMLInputElement>(null);
  const [cajaConfirmada, setCajaConfirmada] = useState(false);
  const [cerrado, setCerrado] = useState(false);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const [cargandoProgreso, setCargandoProgreso] = useState(false);
  /** En qué tienda dice él que ha trabajado hoy. null = aún no ha contestado. */
  const [sedeConfirmada, setSedeConfirmada] = useState<string | null>(null);
  const [sedes, setSedes] = useState<{ id: string; nombre: string }[]>([]);
  const [sedeElegida, setSedeElegida] = useState("");
  const [motivoSede, setMotivoSede] = useState<MotivoSede>("ninguna");
  const [confirmandoSede, setConfirmandoSede] = useState(false);
  /** Hoy cierra él la tienda: le toca el arqueo de la semana (ticket 3b7e05d1). */
  const [arqueo, setArqueo] = useState<{
    toca: boolean;
    /** Domingo y su tienda sin arquear, aunque a él no le salga el paso. */
    pendienteEnSede: boolean;
    semana: string;
    sede: string | null;
  }>({ toca: false, pendienteEnSede: false, semana: "", sede: null });
  const [arqueoEfectivo, setArqueoEfectivo] = useState("");
  const [arqueoNotas, setArqueoNotas] = useState("");
  const [arqueoHecho, setArqueoHecho] = useState<{
    declarado: number;
    esperado: number | null;
    diferencia: number | null;
    descuadre: boolean;
  } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const [resCat, resHoy] = await Promise.all([
          fetch("/api/articulos-venta"),
          fetch("/api/cierre-turno/hoy"),
        ]);
        if (resCat.ok) {
          const data = (await resCat.json()) as { articulos: Articulo[]; catalogoVacio: boolean };
          if (!cancelado) {
            setArticulos(data.articulos ?? []);
            setCatalogoVacio(Boolean(data.catalogoVacio));
          }
        }
        // Recupera lo ya guardado hoy: cerrar la sesión a medias no debe costar el trabajo.
        if (resHoy.ok) {
          const hoy = (await resHoy.json()) as {
            existe: boolean;
            cerrado?: boolean;
            detalleJornada?: string;
            incidencia?: string | null;
            ventas?: { articuloId: string; cantidad: number }[];
            caja?: { efectivo: number; tarjeta: number; confirmado: boolean } | null;
            sedeSinEfectivo?: boolean;
            sedeCierre?: string | null;
            sedes?: { id: string; nombre: string }[];
            sugerida?: { sedeId: string | null; motivo: MotivoSede };
            arqueo?: {
              toca: boolean;
              pendienteEnSede: boolean;
              semana: string;
              sede: string | null;
            };
          };
          if (!cancelado) {
            setSedeSinEfectivo(hoy.sedeSinEfectivo === true);
            setSedes(hoy.sedes ?? []);
            setSedeConfirmada(hoy.sedeCierre ?? null);
            // Preseleccionada la que se le propone: confirmar es un toque, no
            // buscar su tienda en una lista de veinte.
            setSedeElegida(hoy.sedeCierre ?? hoy.sugerida?.sedeId ?? "");
            setMotivoSede(hoy.sugerida?.motivo ?? "ninguna");
            if (hoy.arqueo) setArqueo(hoy.arqueo);
          }
          if (!cancelado && hoy.existe) {
            setDetalle(hoy.detalleJornada ?? "");
            setCantidades(
              Object.fromEntries((hoy.ventas ?? []).map((v) => [v.articuloId, String(v.cantidad)])),
            );
            if (hoy.caja) {
              setEfectivo(String(hoy.caja.efectivo));
              setTarjeta(String(hoy.caja.tarjeta));
              setCajaConfirmada(hoy.caja.confirmado);
            }
            if (hoy.incidencia) {
              setHayIncidencia(true);
              setIncidencia(hoy.incidencia);
            }
            setCerrado(Boolean(hoy.cerrado));
          }
        }
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  /** Deja fijada la tienda del día y arranca el cierre con ella. */
  const confirmarSede = async () => {
    if (!sedeElegida) {
      toast({ title: "Falta un dato", description: "Dinos en qué tienda estás hoy.", variant: "destructive" });
      return;
    }
    setConfirmandoSede(true);
    try {
      const res = await fetch("/api/cierre-turno/sede", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiendaId: sedeElegida }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "No se pudo guardar", description: data.error ?? "Inténtalo de nuevo.", variant: "destructive" });
        return;
      }
      setSedeConfirmada(sedeElegida);
      setSedeSinEfectivo(data.sede?.sinEfectivo === true);
      // El progreso del mes es por tienda: si la cambia, hay que volver a pedirlo.
      setProgreso(null);
      onGuardado?.();
    } catch {
      toast({ title: "Sin conexión", description: "No se ha podido guardar. Revisa la conexión.", variant: "destructive" });
    } finally {
      setConfirmandoSede(false);
    }
  };

  // Los pasos de HOY: el arqueo solo si le toca cerrar la tienda.
  const pasos = pasosDelCierre({ conArqueo: arqueo.toca || arqueoHecho !== null });
  const indice = pasos.indexOf(paso);

  /**
   * Declara el arqueo de la semana de su tienda. El importe va a ciegas: la
   * comparación con lo que debería haber se le enseña al volver la respuesta.
   */
  const guardarArqueo = async (): Promise<boolean> => {
    if (!arqueoEfectivo.trim()) {
      toast({
        title: "Falta el importe",
        description: "Cuenta el efectivo del sobre y escribe cuánto hay.",
        variant: "destructive",
      });
      return false;
    }
    setGuardando(true);
    try {
      const res = await fetch("/api/arqueos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          semana: arqueo.semana,
          efectivo: arqueoEfectivo,
          notas: arqueoNotas,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "No se pudo guardar el arqueo", description: data.error ?? "", variant: "destructive" });
        return false;
      }
      setArqueoHecho({
        declarado: data.declarado,
        esperado: data.esperado ?? null,
        diferencia: data.diferencia ?? null,
        descuadre: Boolean(data.descuadre),
      });
      onGuardado?.();
      return true;
    } catch {
      toast({ title: "Sin conexión", description: "No se ha podido guardar el arqueo.", variant: "destructive" });
      return false;
    } finally {
      setGuardando(false);
    }
  };


  /** Guarda el paso 1. Se llama al avanzar: nadie tiene que acordarse de pulsar guardar. */
  const guardarBorrador = async (): Promise<boolean> => {
    setGuardando(true);
    try {
      const res = await fetch("/api/cierre-turno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detalleJornada: detalle,
          ventas: Object.entries(cantidades)
            .map(([articuloId, v]) => ({ articuloId, cantidad: parseInt(v, 10) || 0 }))
            .filter((v) => v.cantidad > 0),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "No se pudo guardar", description: data.error ?? "Inténtalo de nuevo.", variant: "destructive" });
        return false;
      }
      onGuardado?.();
      return true;
    } catch {
      toast({ title: "Sin conexión", description: "No se ha podido guardar. Revisa la conexión.", variant: "destructive" });
      return false;
    } finally {
      setGuardando(false);
    }
  };

  /** Guarda la caja; con `confirmar` deja de ser modificable por el comercial. */
  const guardarCaja = async (confirmar: boolean): Promise<boolean> => {
    setGuardando(true);
    try {
      const res = await fetch("/api/cierre-turno/caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ efectivo: efectivo || 0, tarjeta: tarjeta || 0, confirmar }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "No se pudo guardar la caja", description: data.error ?? "Inténtalo de nuevo.", variant: "destructive" });
        return false;
      }
      if (confirmar) {
        setCajaConfirmada(true);
        toast({ title: "Caja confirmada", description: "A partir de ahora solo un administrador puede corregirla." });
      }
      onGuardado?.();
      return true;
    } catch {
      toast({ title: "Sin conexión", description: "No se ha podido guardar la caja.", variant: "destructive" });
      return false;
    } finally {
      setGuardando(false);
    }
  };

  const cargarAdjuntos = useCallback(async () => {
    try {
      const res = await fetch("/api/cierre-turno/adjuntos");
      if (!res.ok) return;
      const data = (await res.json()) as { adjuntos: AdjuntoCierre[] };
      setAdjuntos(data.adjuntos ?? []);
    } catch {
      /* sin conexión: la lista se queda como esté */
    }
  }, []);

  /** Sube un archivo al cierre de caja. Requiere haber guardado los importes. */
  const subirAdjunto = async (tipo: TipoAdjuntoUI, fichero: File) => {
    setSubiendo(tipo);
    try {
      // Guarda los importes primero: el servidor exige que exista la caja.
      if (!cajaConfirmada && !(await guardarCaja(false))) return;

      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("No se ha podido leer el archivo"));
        fr.readAsDataURL(fichero);
      });

      const res = await fetch("/api/cierre-turno/adjuntos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          nombre: fichero.name,
          mime: fichero.type || "application/octet-stream",
          contenidoBase64: base64,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "No se pudo adjuntar", description: data.error ?? "Inténtalo de nuevo.", variant: "destructive" });
        return;
      }
      await cargarAdjuntos();
      toast({ title: "Archivo adjuntado", description: fichero.name });
    } catch (err) {
      toast({
        title: "Error al adjuntar",
        description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setSubiendo(null);
      if (inputStock.current) inputStock.current.value = "";
      if (inputTpv.current) inputTpv.current.value = "";
    }
  };

  const quitarAdjunto = async (id: string) => {
    const res = await fetch(`/api/cierre-turno/adjuntos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ title: "No se pudo quitar", description: data.error ?? "", variant: "destructive" });
      return;
    }
    await cargarAdjuntos();
  };

  // Los adjuntos se cargan al llegar al paso de caja, no antes: con datos del
  // móvil, cada petición cuenta.
  useEffect(() => {
    if (paso === "caja") void cargarAdjuntos();
  }, [paso, cargarAdjuntos]);

  /**
   * El progreso del mes se pide cada vez que se entra al paso 2, no una sola
   * vez: si acaba de guardar las ventas de hoy en el paso 1, tiene que verlas
   * ya contadas.
   */
  useEffect(() => {
    if (paso !== "resultados") return;
    let cancelado = false;
    (async () => {
      setCargandoProgreso(true);
      try {
        const res = await fetch("/api/cierre-turno/progreso");
        if (!res.ok) return;
        const data = (await res.json()) as Progreso;
        if (!cancelado) setProgreso(data);
      } catch {
        /* sin conexión: se queda con lo último que tuviera */
      } finally {
        if (!cancelado) setCargandoProgreso(false);
      }
    })();
    return () => {
      cancelado = true;
    };
    // `sedeConfirmada` entra aquí porque los dos cuadros de tienda son de la sede
    // elegida: si la cambia a media faena, hay que volver a pedir las cifras.
  }, [paso, sedeConfirmada]);

  /** Paso 4: cierra el turno y, si hay incidencia, dispara el aviso. */
  const cerrarTurno = async () => {
    if (hayIncidencia === null) {
      toast({ title: "Falta un dato", description: "Dinos si ha habido alguna incidencia.", variant: "destructive" });
      return;
    }
    setGuardando(true);
    try {
      const res = await fetch("/api/cierre-turno/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hayIncidencia, incidencia }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "No se pudo cerrar", description: data.error ?? "Inténtalo de nuevo.", variant: "destructive" });
        // Le falta el arqueo del domingo: se le lleva al paso, en vez de dejarlo
        // con un aviso y sin saber dónde se hace.
        if (data.code === "sin_arqueo") {
          setArqueo((a) => ({ ...a, toca: true }));
          setPaso("arqueo");
        }
        return;
      }
      setCerrado(true);
      onGuardado?.();
      toast({
        title: "Turno cerrado",
        description: data.conIncidencia
          ? "Tus responsables han recibido el aviso de la incidencia."
          : "Todo registrado. Buen trabajo.",
      });
    } catch {
      toast({ title: "Sin conexión", description: "No se ha podido cerrar el turno.", variant: "destructive" });
    } finally {
      setGuardando(false);
    }
  };

  /** Avanzar guarda lo del paso actual antes de moverse. */
  const siguiente = async () => {
    if (paso === "ventas" && !(await guardarBorrador())) return;
    if (paso === "caja" && !cajaConfirmada && !(await guardarCaja(false))) return;
    // Del arqueo no se sale sin declararlo: es el paso que cierra la tienda.
    if (paso === "arqueo" && !arqueoHecho && !(await guardarArqueo())) return;
    setPaso(pasos[Math.min(pasos.length - 1, indice + 1)]!);
  };
  const totalUnidades = useMemo(
    () => Object.values(cantidades).reduce((n, v) => n + (parseInt(v, 10) || 0), 0),
    [cantidades],
  );
  /**
   * El catálogo en el orden que le ha dado administración, agrupado solo por
   * categoría: la subcategoría se usa para colocar los artículos, pero no se
   * enseña al rellenar (ticket c60153e3). `ambiguos` son los pocos artículos a
   * los que sí hace falta ponérsela para poder distinguirlos.
   */
  const { grupos, ambiguos, enVariasCategorias } = useMemo(() => {
    const agrupado = agruparCatalogo(articulos);
    // Nombres que existen en MÁS DE UNA categoría ("Fibra General" en Particular
    // y en Empresa). Son los que hacen que se rellene la fila equivocada, así
    // que en esos la categoría se repite en la propia fila: quien está
    // escribiendo no tiene por qué acordarse de bajo qué cabecera está
    // (ticket 41c7d0e2).
    const categoriasPorNombre = new Map<string, Set<string>>();
    for (const a of articulos) {
      const clave = a.nombre.trim().toLowerCase();
      const previo = categoriasPorNombre.get(clave) ?? new Set<string>();
      previo.add(a.categoria ?? "");
      categoriasPorNombre.set(clave, previo);
    }
    return {
      grupos: agrupado.map((g) => ({
        categoria: g.categoria,
        articulos: aplanarCatalogo([g]),
      })),
      ambiguos: articulosConNombreAmbiguo(agrupado),
      enVariasCategorias: new Set(
        [...categoriasPorNombre.entries()].filter(([, cats]) => cats.size > 1).map(([n]) => n),
      ),
    };
  }, [articulos]);

  const nombreSedeConfirmada = sedes.find((t) => t.id === sedeConfirmada)?.nombre ?? null;

  // Antes de nada, dónde ha trabajado hoy. Todo lo que viene después —los
  // objetivos de tienda, la caja, el arqueo— cuelga de esta respuesta.
  if (!cargando && !sedeConfirmada) {
    return (
      <div className={enDialogo ? "space-y-6" : "p-6 space-y-6 max-w-3xl"}>
        {!enDialogo && (
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Cierre de turno</h1>
          </div>
        )}
        <Card className="mx-auto max-w-md">
          <CardContent className="p-6 text-center space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Confirma tu centro de trabajo de hoy
              </h2>
              <p className="text-sm text-slate-500 mt-1">{PORQUE_SEDE[motivoSede]}</p>
            </div>
            <div className="text-left">
              <Label htmlFor="cierre-sede">Tienda</Label>
              <select
                id="cierre-sede"
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-base"
                value={sedeElegida}
                onChange={(e) => setSedeElegida(e.target.value)}
              >
                <option value="">Elige tu tienda…</option>
                {sedes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </div>
            <Button
              className="w-full"
              onClick={confirmarSede}
              disabled={confirmandoSede || !sedeElegida}
            >
              {confirmandoSede ? "Guardando…" : "Confirmar y empezar"}
            </Button>
            <p className="text-xs text-slate-400">
              Si hoy has cubierto en otra tienda, cámbiala aquí: tus ventas y tu caja
              irán a la que elijas.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={enDialogo ? "space-y-6" : "p-6 space-y-6 max-w-3xl"}>
      {!enDialogo && (
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cierre de turno</h1>
          <p className="text-slate-500 text-sm mt-1">
            Registra tus ventas del día, cierra la caja y avisa de cualquier incidencia.
          </p>
        </div>
      )}

      {nombreSedeConfirmada && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-600">
            Cerrando en <strong className="text-slate-900">{nombreSedeConfirmada}</strong>
          </span>
          {!cerrado && !cajaConfirmada && (
            <button
              type="button"
              className="text-[var(--primary)] underline underline-offset-2"
              onClick={() => setSedeConfirmada(null)}
            >
              No es esta
            </button>
          )}
        </div>
      )}

      {/* Tira de pasos: la numeración es información real, es una secuencia. */}
      <ol className="flex flex-wrap gap-2">
        {pasos.map((p, i) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => setPaso(p)}
              aria-current={p === paso ? "step" : undefined}
              className={
                p === paso
                  ? "px-3 py-1.5 rounded-md text-sm font-semibold bg-[var(--primary)] text-white"
                  : "px-3 py-1.5 rounded-md text-sm text-slate-500 hover:text-slate-800 border border-slate-200"
              }
            >
              <span className="tabular-nums opacity-70 mr-1.5">{i + 1}</span>
              {TITULOS[p]}
            </button>
          </li>
        ))}
      </ol>

      {cerrado ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Tu turno de hoy ya está cerrado. Si algo no cuadra, pídeselo a un administrador:
            es el único que puede corregirlo, y queda registrado.
          </span>
        </div>
      ) : cajaConfirmada ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
          <span>Caja confirmada. Ya no puedes cambiar los importes; te queda cerrar el turno.</span>
        </div>
      ) : null}

      {paso === "ventas" && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            {cargando ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : catalogoVacio ? (
              <div className="text-center py-8 text-slate-500 text-sm flex flex-col items-center gap-2">
                <PackageOpen className="h-6 w-6 text-slate-400" />
                <p className="font-medium text-slate-700">Todavía no hay catálogo de ventas</p>
                <p className="max-w-sm">
                  Tu empresa tiene que subir la lista de artículos y servicios antes de que
                  puedas registrar las ventas del día.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-3 py-2">
                        Artículo o servicio
                      </th>
                      <th className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500 px-3 py-2 w-32">
                        Cantidad
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Agrupado por categoría, tal y como lo ha colocado
                        administración en Configuración: en un catálogo largo,
                        buscar el artículo en una lista corrida al final del
                        turno es lo que hace que se rellene a ojo. La
                        subcategoría ordena los artículos dentro de su categoría
                        pero no se enseña: es un dato interno de los objetivos
                        (ticket c60153e3). */}
                    {grupos.map((grupo, iGrupo) => {
                      const color = COLOR_CATEGORIA[iGrupo % COLOR_CATEGORIA.length]!;
                      return (
                      <Fragment key={`cat-${grupo.categoria ?? "__sin__"}`}>
                        {/* Si la empresa no usa categorías, el catálogo es una
                            lista corrida y no hay nada que encabezar; en cuanto
                            hay alguna, lo que se quedó fuera se ve como "Otros"
                            en vez de aparecer suelto sin explicación.

                            La cabecera va PEGADA ARRIBA (sticky) y con color
                            fuerte: en un catálogo largo se rellena bajando, y si
                            la etiqueta se pierde de vista ya no se sabe en qué
                            bloque se está escribiendo (ticket 41c7d0e2). */}
                        {(grupo.categoria || grupos.length > 1) && (
                          <tr>
                            {/* El sticky va en la CELDA y no en la fila: en
                                Safari e iOS `position: sticky` sobre un <tr> no
                                hace nada, y parte del equipo cierra desde el móvil. */}
                            <td
                              colSpan={2}
                              className={`sticky top-0 z-10 px-3 py-2 ${color.fondo}`}
                            >
                              <span className="text-sm font-bold uppercase tracking-wider text-white">
                                {grupo.categoria ?? "Otros"}
                              </span>
                            </td>
                          </tr>
                        )}
                        {grupo.articulos.map((a) => (
                          <tr
                            key={a.id}
                            className={`border-b border-slate-100 last:border-0 border-l-4 ${color.borde}`}
                          >
                            <td className="px-3 py-2 text-sm text-slate-800">
                              {a.nombre}
                              {/* El mismo nombre en dos categorías es lo que
                                  hace que se rellene la fila equivocada: se
                                  repite la categoría aquí, para no depender de
                                  que se vea la cabecera. */}
                              {grupo.categoria &&
                                enVariasCategorias.has(a.nombre.trim().toLowerCase()) && (
                                  <span
                                    className={`ml-2 align-middle text-[11px] font-semibold uppercase px-1.5 py-0.5 rounded ${color.chip}`}
                                  >
                                    {grupo.categoria}
                                  </span>
                                )}
                              {/* Dos artículos de la misma categoría con el
                                  mismo nombre solo se distinguen por su
                                  subcategoría: ahí sí se dice, o serían dos
                                  filas idénticas y se rellenarían al azar. */}
                              {ambiguos.has(a.id) && a.subcategoria && (
                                <span className="block text-xs text-slate-400">
                                  {a.subcategoria}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min="0"
                                className="text-right tabular-nums"
                                value={cantidades[a.id] ?? ""}
                                onChange={(e) =>
                                  setCantidades((c) => ({ ...c, [a.id]: e.target.value }))
                                }
                                placeholder="0"
                              />
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50">
                      <td className="px-3 py-2 text-sm font-semibold text-slate-700">Total</td>
                      <td className="px-3 py-2 text-right text-sm font-bold tabular-nums">
                        {totalUnidades}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div>
              <Label htmlFor="detalle-jornada">Detalle de la jornada</Label>
              {/* Lo que no es una venta del catálogo no se declara arriba y, sin
                  esto, un día entero de gestiones parece un día vacío. */}
              <p className="text-xs text-slate-500 mt-0.5">
                Aquí va lo que no es una venta de la lista: duplicados, recargas, gestiones,
                seguimiento. Rellénalo también los días flojos: es lo que los explica.
              </p>
              <textarea
                id="detalle-jornada"
                rows={4}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                placeholder="Duplicados, recargas, cambios de titular, una portabilidad que se cayó, un cliente que vuelve mañana a firmar…"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {paso === "resultados" && (
        <Card>
          <CardContent className="pt-4 pb-4">
            {cargandoProgreso ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                {/* Los tres objetivos que le afectan, uno por cuadro y cada
                    uno con su color: el suyo, el de su tienda y el que el
                    operador le impone a la tienda (ticket 8f2a04e1). Van en
                    tarjetas y no en una tabla porque lo que se mira aquí de un
                    vistazo es "voy o no voy", y un porcentaje grande con su
                    barra se lee sin buscar la fila. */}
                <div className="grid gap-3 md:grid-cols-3">
                  <CuadroObjetivo
                    titulo="Objetivo individual"
                    subtitulo="Lo que te toca a ti este mes"
                    tono={TONOS.propio}
                    dato={progreso?.propio ?? null}
                  />
                  <CuadroObjetivo
                    titulo="Objetivo de tu PDV completo"
                    /* El nombre de la tienda baja al subtítulo: el título dice de
                       qué objetivo se trata y el subtítulo, de qué tienda. Quien
                       cubre en varias necesita las dos cosas. */
                    subtitulo={progreso?.sedeNombre ?? "El objetivo de la tienda entera"}
                    tono={TONOS.sede}
                    dato={progreso?.sede ?? null}
                  />
                  <CuadroObjetivo
                    titulo="Objetivo Tu máquina del tiempo"
                    subtitulo={
                      progreso?.sedeNombre
                        ? `TMT · ${progreso.sedeNombre}`
                        : "Lo que pide el operador a la tienda"
                    }
                    tono={TONOS.tmt}
                    dato={progreso?.sedeTmt ?? null}
                  />
                </div>

                {/* Detalle de lo que ha vendido él, producto a producto: lo que
                    se persigue está arriba, esto es para cuadrar sus cifras. */}
                {(progreso?.porArticulo.length ?? 0) > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          {[
                            "Tus ventas por artículo",
                            "Este mes",
                            ...(progreso?.preciosActivos ? ["Importe"] : []),
                          ].map((h) => (
                            <th
                              key={h}
                              className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-3 py-2"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {progreso?.porArticulo.map((a) => (
                          <tr key={a.articuloId} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-2 text-sm text-slate-800">
                              {a.nombre}
                              {/* Sin esta nota, sus unidades parecen perdidas:
                                  se ven aquí y no en el objetivo de arriba. */}
                              {!a.cuentaParaObjetivos && (
                                <span className="block text-xs text-slate-400">
                                  No cuenta para los objetivos
                                </span>
                              )}
                            </td>
                            {/* El detalle de lo suyo: el objetivo se persigue
                                por grupo, en los cuadros de arriba. */}
                            <td className="px-3 py-2 text-sm tabular-nums">{a.vendido}</td>
                            {progreso?.preciosActivos && (
                              <td className="px-3 py-2 text-sm tabular-nums text-slate-500">
                                {a.importe === null ? "—" : eur(a.importe)}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Dos filas con el mismo nombre serían un duplicado a los
                        ojos de quien lo lee: se suman, y se dice por qué la
                        cifra no cuadra con una sola línea del catálogo. */}
                    {progreso?.porArticulo.some((a) => a.productos > 1) && (
                      <p className="text-xs text-slate-400 mt-2">
                        Los productos que se llaman igual se suman en una sola fila, aunque el
                        catálogo los tenga en categorías distintas.
                      </p>
                    )}
                  </div>
                )}

                <p className="text-xs text-slate-400 mt-3">
                  {progreso &&
                  progreso.propio.objetivo === null &&
                  progreso.sede?.objetivo == null &&
                  progreso.sedeTmt?.objetivo == null
                    ? "Tu empresa todavía no ha fijado objetivos para este mes. Aquí verás lo que llevas vendido."
                    : "Cuenta lo registrado en tus cierres de este mes, incluido el de hoy si ya lo has guardado."}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {paso === "caja" && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            {/* En un córner el dinero lo cobra y lo liquida el tercero, así que
                pedir efectivo y tarjeta sería pedir un dato que no existe: lo que
                cuadra su cierre son el stock y los tickets facturados. */}
            {sedeSinEfectivo ? (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                <p className="text-sm font-semibold text-sky-900">
                  En esta tienda no se cuenta caja
                </p>
                <p className="text-xs text-sky-800 mt-1">
                  El cobro lo hace el centro y nos lo liquida después, así que aquí no hay efectivo
                  ni tarjeta que declarar. Registra tus ventas como siempre y sube el stock y los
                  tickets de las ventas facturadas: con eso se cuadra la liquidación.
                </p>
              </div>
            ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="efectivo">Cobrado en efectivo</Label>
                <Input
                  id="efectivo"
                  type="number"
                  step="0.01"
                  min="0"
                  className="mt-1 tabular-nums"
                  value={efectivo}
                  onChange={(e) => setEfectivo(e.target.value)}
                  placeholder="0,00"
                  disabled={cajaConfirmada || cerrado}
                />
              </div>
              <div>
                <Label htmlFor="tarjeta">Cobrado con tarjeta</Label>
                <Input
                  id="tarjeta"
                  type="number"
                  step="0.01"
                  min="0"
                  className="mt-1 tabular-nums"
                  value={tarjeta}
                  onChange={(e) => setTarjeta(e.target.value)}
                  placeholder="0,00"
                  disabled={cajaConfirmada || cerrado}
                />
              </div>
            </div>
            )}
            {/* Adjuntos: se pueden seguir subiendo tras confirmar los importes,
                porque los comprobantes del datáfono a veces salen después. */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-800">Documentación del cierre</p>
              <input
                ref={inputStock}
                type="file"
                accept=".xlsx,.xls,.csv,application/pdf,image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void subirAdjunto("stock", f);
                }}
              />
              <input
                ref={inputTpv}
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void subirAdjunto("tpv", f);
                }}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={subiendo !== null || cerrado}
                  onClick={() => inputStock.current?.click()}
                >
                  <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                  {subiendo === "stock" ? "Subiendo…" : "Excel del stock"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={subiendo !== null || cerrado}
                  onClick={() => inputTpv.current?.click()}
                >
                  <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                  {subiendo === "tpv"
                    ? "Subiendo…"
                    : sedeSinEfectivo
                      ? "Tickets de ventas facturadas"
                      : "Comprobante del TPV"}
                </Button>
              </div>

              {adjuntos.length > 0 ? (
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {adjuntos.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="text-slate-400 text-xs uppercase tracking-wide mr-2">
                          {a.tipo === "stock" ? "Stock" : "TPV"}
                        </span>
                        <span className="text-slate-800 break-all">{a.nombre}</span>
                        <span className="text-slate-400 text-xs ml-2 tabular-nums">{kb(a.tamañoBytes)}</span>
                      </span>
                      {!cerrado && (
                        <Button variant="ghost" size="sm" onClick={() => void quitarAdjunto(a.id)}>
                          Quitar
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">
                  Sin archivos todavía. Admite Excel, CSV, PDF y fotos, hasta 10 MB cada uno.
                </p>
              )}
            </div>

            <p className="text-sm text-slate-500">
              Al confirmar, los importes quedan cerrados: solo un administrador podrá
              corregirlos, y quedará registrado quién lo cambió y por qué. Los archivos sí
              puedes seguir añadiéndolos hasta que cierres el turno.
            </p>
            {!cajaConfirmada && !cerrado && (
              <div className="flex justify-end">
                <Button variant="outline" disabled={guardando} onClick={() => void guardarCaja(true)}>
                  {guardando ? "Guardando…" : "Confirmar cierre de caja"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {paso === "arqueo" && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
              <p className="text-sm font-semibold text-violet-900">
                Hoy cierras tú la tienda: toca el arqueo de la semana
              </p>
              <p className="text-xs text-violet-800 mt-1">
                Cuenta todo el efectivo acumulado de {arqueo.sede ?? "la tienda"}, mételo en un
                sobre y escribe aquí cuánto hay. <strong>El fondo de cambio se queda en el
                cajón</strong>: no lo cuentes ni lo metas en el sobre. El sobre espera en la
                tienda a que pase un responsable a recogerlo y firmarlo.
              </p>
            </div>

            {arqueoHecho ? (
              <>
                <div
                  className={
                    arqueoHecho.descuadre
                      ? "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2"
                      : "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex items-start gap-2"
                  }
                >
                  {arqueoHecho.descuadre ? (
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  )}
                  <span>
                    {arqueoHecho.esperado === null ? (
                      <>
                        Arqueo registrado: <strong>{eur(arqueoHecho.declarado)}</strong>. La caja
                        de esta tienda estaba pendiente de aclarar, así que no se puede comparar.
                      </>
                    ) : arqueoHecho.descuadre ? (
                      <>
                        Has metido <strong>{eur(arqueoHecho.declarado)}</strong> y debería haber{" "}
                        <strong>{eur(arqueoHecho.esperado)}</strong>:{" "}
                        {eur(Math.abs(arqueoHecho.diferencia ?? 0))}{" "}
                        {(arqueoHecho.diferencia ?? 0) > 0 ? "de más" : "de menos"}. Cuéntalo en
                        el siguiente paso como incidencia.
                      </>
                    ) : (
                      <>
                        Cuadra: <strong>{eur(arqueoHecho.declarado)}</strong>. El sobre queda a la
                        espera de que lo recojan.
                      </>
                    )}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Si te has equivocado, un administrador puede corregirlo desde Arqueos.
                </p>
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor="arqueo-efectivo">Efectivo que va al sobre</Label>
                  <Input
                    id="arqueo-efectivo"
                    type="number"
                    step="0.01"
                    min="0"
                    className="mt-1 tabular-nums"
                    value={arqueoEfectivo}
                    onChange={(e) => setArqueoEfectivo(e.target.value)}
                    placeholder="0,00"
                  />
                  {/* A ciegas a propósito: si ve antes lo que debería haber, lo
                      teclea sin contar y el arqueo no detecta nada. */}
                  <p className="text-xs text-slate-400 mt-1">
                    Cuéntalo primero. Al guardar te decimos si cuadra.
                  </p>
                </div>
                <div>
                  <Label htmlFor="arqueo-notas">¿Algo que aclarar? (opcional)</Label>
                  <textarea
                    id="arqueo-notas"
                    rows={2}
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    value={arqueoNotas}
                    onChange={(e) => setArqueoNotas(e.target.value)}
                    placeholder="Faltan 20 € que puse de cambio, un billete roto…"
                  />
                </div>
                <div className="flex justify-end">
                  <Button variant="outline" disabled={guardando} onClick={() => void guardarArqueo()}>
                    {guardando ? "Guardando…" : "Declarar el arqueo"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {paso === "incidencias" && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            {/* Es domingo, la tienda sigue sin arquear y a esta persona no le ha
                salido el paso porque el cuadrante dice que sale otro después. Si
                el cuadrante está mal, el domingo se quedaría sin arquear sin que
                nadie se entere: se le avisa para que lo diga. */}
            {arqueo.pendienteEnSede && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  <strong>
                    {arqueo.sede ?? "Tu tienda"} todavía no ha declarado el arqueo de esta
                    semana.
                  </strong>{" "}
                  Si eres tú quien cierra hoy la tienda, avisa a un responsable y cuéntalo aquí
                  como incidencia: el dinero no se puede quedar sin arquear.
                </span>
              </div>
            )}

            <div>
              <p className="text-sm font-medium text-slate-800 mb-2">
                ¿Ha habido alguna incidencia en el turno?
              </p>
              <div className="flex gap-2">
                <Button
                  variant={hayIncidencia === false ? "default" : "outline"}
                  onClick={() => setHayIncidencia(false)}
                >
                  No
                </Button>
                <Button
                  variant={hayIncidencia === true ? "default" : "outline"}
                  onClick={() => setHayIncidencia(true)}
                >
                  Sí
                </Button>
              </div>
            </div>
            {hayIncidencia === true && (
              <div>
                <Label htmlFor="incidencia">Cuéntanos qué ha pasado</Label>
                <textarea
                  id="incidencia"
                  rows={4}
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  value={incidencia}
                  onChange={(e) => setIncidencia(e.target.value)}
                  placeholder="Qué ha ocurrido, con qué importe o artículo, y qué has hecho."
                />
                <p className="text-xs text-slate-500 mt-2">
                  Al cerrar el turno, tus responsables recibirán un aviso con este cierre y la
                  incidencia.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button
          variant="outline"
          disabled={indice === 0}
          onClick={() => setPaso(pasos[Math.max(0, indice - 1)]!)}
        >
          Atrás
        </Button>
        {indice === pasos.length - 1 ? (
          <Button disabled={guardando || cerrado} onClick={() => void cerrarTurno()}>
            {cerrado ? "Turno cerrado" : guardando ? "Cerrando…" : "Cerrar turno"}
          </Button>
        ) : (
          <Button disabled={guardando || cerrado} onClick={() => void siguiente()}>
            {guardando ? "Guardando…" : "Siguiente"}
          </Button>
        )}
      </div>
    </div>
  );
}
