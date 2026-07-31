"use client";

/**
 * Asistente diario de cierre de turno (4 pasos), con guardado real.
 *
 * Cada comercial cierra SU caja (decidido con el cliente el 2026-07-30): es lo
 * que permite atribuir un descuadre a una persona. El borrador se guarda al
 * avanzar de paso, así que cerrar el móvil a media faena no pierde el trabajo.
 *
 * Confirmar la caja es irreversible para el comercial: a partir de ahí solo un
 * administrador puede corregirla, y queda registrado. Se avisa antes.
 *
 * El asistente NO condiciona el fichaje: se puede fichar la salida sin haber
 * cerrado (RD 8/2019, misma regla que el geofencing y el checklist de fichaje).
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
import { PASOS_CIERRE, type PasoCierre } from "@/lib/cierre-turno/core";
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

const TITULOS: Record<PasoCierre, string> = {
  ventas: "Ventas del día",
  resultados: "Cómo vas",
  caja: "Cierre de caja",
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
        // Recupera lo ya guardado hoy: cerrar el móvil no debe costar el trabajo.
        if (resHoy.ok) {
          const hoy = (await resHoy.json()) as {
            existe: boolean;
            cerrado?: boolean;
            detalleJornada?: string;
            incidencia?: string | null;
            ventas?: { articuloId: string; cantidad: number }[];
            caja?: { efectivo: number; tarjeta: number; confirmado: boolean } | null;
          };
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

  const indice = PASOS_CIERRE.indexOf(paso);


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
      toast({ title: "Sin conexión", description: "No se ha podido guardar. Revisa la cobertura.", variant: "destructive" });
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

  // Los adjuntos se cargan al llegar al paso de caja, no antes: en el móvil
  // cada petición cuenta.
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
  }, [paso]);

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
    setPaso(PASOS_CIERRE[Math.min(PASOS_CIERRE.length - 1, indice + 1)]);
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
  const { grupos, ambiguos } = useMemo(() => {
    const agrupado = agruparCatalogo(articulos);
    return {
      grupos: agrupado.map((g) => ({
        categoria: g.categoria,
        articulos: aplanarCatalogo([g]),
      })),
      ambiguos: articulosConNombreAmbiguo(agrupado),
    };
  }, [articulos]);

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

      {/* Tira de pasos: la numeración es información real, es una secuencia. */}
      <ol className="flex flex-wrap gap-2">
        {PASOS_CIERRE.map((p, i) => (
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
                    {grupos.map((grupo) => (
                      <Fragment key={`cat-${grupo.categoria ?? "__sin__"}`}>
                        {/* Si la empresa no usa categorías, el catálogo es una
                            lista corrida y no hay nada que encabezar; en cuanto
                            hay alguna, lo que se quedó fuera se ve como "Otros"
                            en vez de aparecer suelto sin explicación. */}
                        {(grupo.categoria || grupos.length > 1) && (
                          <tr className="bg-slate-50 border-y border-slate-200">
                            <td
                              colSpan={2}
                              className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600"
                            >
                              {grupo.categoria ?? "Otros"}
                            </td>
                          </tr>
                        )}
                        {grupo.articulos.map((a) => (
                          <tr key={a.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-2 text-sm text-slate-800">
                              {a.nombre}
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
                    ))}
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
              <textarea
                id="detalle-jornada"
                rows={4}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                placeholder="Qué has hecho durante el turno: visitas, gestiones, seguimiento…"
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
                    titulo="Tu objetivo"
                    subtitulo="Lo que te toca a ti este mes"
                    tono={TONOS.propio}
                    dato={progreso?.propio ?? null}
                  />
                  <CuadroObjetivo
                    titulo={progreso?.sedeNombre ?? "Tu punto de venta"}
                    subtitulo="El objetivo de la tienda entera"
                    tono={TONOS.sede}
                    dato={progreso?.sede ?? null}
                  />
                  <CuadroObjetivo
                    titulo={progreso?.sedeNombre ? `TMT · ${progreso.sedeNombre}` : "TMT"}
                    subtitulo="Lo que pide el operador a la tienda"
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
                  {subiendo === "tpv" ? "Subiendo…" : "Comprobante del TPV"}
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

      {paso === "incidencias" && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
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
          onClick={() => setPaso(PASOS_CIERRE[Math.max(0, indice - 1)])}
        >
          Atrás
        </Button>
        {indice === PASOS_CIERRE.length - 1 ? (
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
