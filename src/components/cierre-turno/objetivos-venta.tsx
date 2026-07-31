"use client";

/**
 * Definición de objetivos de venta: la primera subárea de "Objetivos de venta"
 * (la segunda es el seguimiento diario, `seguimiento-objetivos.tsx`). La misma
 * pantalla para administración (fija los objetivos) y para coordinación (los
 * consulta, de su sede): quién puede escribir lo decide el servidor y llega en
 * `soloLectura`.
 *
 * El mes lo elige el área (`objetivos-venta-area.tsx`) y llega por props: es el
 * mismo indicador y el mismo filtro para las dos subáreas, que es como se pidió
 * —los objetivos son mensuales y se consultan también los de meses pasados.
 *
 * Forma de trabajar: para el mes elegido se rellena una parrilla. Primero la de
 * comerciales —una fila por persona y una columna por producto del catálogo—,
 * debajo la misma parrilla para los puntos de venta y, al final, la de los
 * grupos de objetivos que haya montado el cliente (TMT, televenta…). Son
 * objetivos distintos: el de la sede se compara con lo que vende la sede
 * entera, no con la suma de los de su equipo, y el del grupo con lo que venden
 * sus miembros; por eso van en tablas separadas (ticket ff5ab304).
 *
 * La primera columna de cada parrilla es "Unidades totales" (el objetivo sin
 * producto), que es el que ve el comercial en el paso 2 de su cierre de turno.
 * Si se deja en blanco vale la suma de los objetivos de cada grupo y de cada
 * producto suelto de esa fila: quien rellena producto a producto espera que el
 * total cuadre con lo que ha escrito, no un total aparte que se queda a cero.
 * Escribir un número ahí manda sobre la suma.
 *
 * Detrás van las columnas de grupo —una por subcategoría del catálogo— y luego
 * las de cada producto: son las dos formas de fijar un objetivo, por grupo o
 * por producto individual (ticket 234c6b0f). Un objetivo de grupo se cumple
 * sumando lo vendido de los productos de esa subcategoría que cuentan para
 * objetivos —de todas las categorías: "Empresa → FFTH" y "Particular → FFTH"
 * empujan el mismo objetivo de FFTH (ticket 528694fa)—; los que administración
 * ha marcado como que no cuentan (Configuración → Catálogo de ventas) no tienen
 * columna y sus unidades no suman en ningún objetivo (ticket 714c76dd).
 *
 * Cada casilla se guarda al salir del campo. Poner 0 quita el objetivo: es lo
 * que la gente hace de forma natural para "quitar esto", y pedirle un botón de
 * borrar aparte sería trabajo de más.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Building2,
  Download,
  FileSpreadsheet,
  Layers,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { GruposObjetivoDialog } from "@/components/cierre-turno/grupos-objetivo-dialog";
import { useToast } from "@/hooks/use-toast";

type Ambito = "comercial" | "sede" | "grupo";

/** Columna de unidades totales: el objetivo sin producto (ver `objetivos.ts`). */
const COLUMNA_TOTAL = "";

interface Articulo {
  id: string;
  nombre: string;
  categoria: string | null;
  subcategoria: string | null;
  precio: number | null;
}

/**
 * Un grupo de productos con objetivo: una subcategoría del catálogo. `id` es la
 * columna de la parrilla, tal y como la arma el servidor.
 */
interface Subgrupo {
  id: string;
  subcategoria: string;
  etiqueta: string;
}

interface Columna {
  id: string;
  nombre: string;
  /** Segunda línea de la cabecera: dónde está ese producto o ese grupo. */
  detalle: string | null;
  /** Columna de un grupo de productos (una subcategoría del catálogo). */
  grupo?: Subgrupo;
}

interface Celda {
  objetivoId: string | null;
  objetivo: number | null;
  vendido: number;
  consecucion: number | null;
  /** Unidades totales sin fijar a mano: el objetivo es la suma de los productos. */
  derivado?: boolean;
}

interface FilaMatriz {
  sujetoId: string;
  sujeto: string;
  /** Sede del comercial; en las filas de grupo, de qué se compone el grupo. */
  sede: string | null;
  celdas: Record<string, Celda>;
}

interface TotalColumna {
  objetivo: number;
  vendido: number;
  consecucion: number | null;
  conObjetivo: number;
}

interface ObjetivoDelMes {
  id: string;
  ambito: Ambito;
  sujeto: string;
  articulo: string | null;
  /** Grupo de productos, cuando el objetivo es de una subcategoría entera. */
  grupo: string | null;
  objetivo: number;
  vendido: number;
  consecucion: number | null;
  importe: number | null;
}

/** Lo que devuelve el importador de la plantilla de objetivos. */
interface ResumenImportacion {
  mes: string;
  creados: number;
  actualizados: number;
  borrados: number;
  sinCambios: number;
  ignoradas: { fila: number; motivo: string }[];
  totalIgnoradas: number;
  columnasIgnoradas: { columna: string; motivo: string }[];
}

/** Objetivo de zona de una coordinadora (ticket 73). */
interface ObjetivoPropio {
  objetivo: number;
  vendido: number;
  consecucion: number | null;
  sedesCumplen: number;
  sedesConObjetivo: number;
  comercialesCumplen: number;
  comercialesConObjetivo: number;
}

interface Respuesta {
  mes: string;
  soloLectura: boolean;
  preciosActivos: boolean;
  articulos: Articulo[];
  /** Grupos del catálogo (subcategorías con algún producto que cuenta). */
  subgrupos: Subgrupo[];
  /** Productos que el cliente ha dejado fuera de los objetivos, por su nombre. */
  excluidos: string[];
  filasComerciales: FilaMatriz[];
  filasSedes: FilaMatriz[];
  /** Una fila por grupo de objetivos del cliente (TMT, televenta…). */
  filasGrupos: FilaMatriz[];
  totalesComerciales: Record<string, TotalColumna>;
  totalesSedes: Record<string, TotalColumna>;
  totalesGrupos: Record<string, TotalColumna>;
  objetivosDelMes: ObjetivoDelMes[];
  resumen: { objetivo: number; vendido: number; conObjetivo: number };
  /** Solo para coordinación: su objetivo de zona. null para administración. */
  objetivoPropio?: ObjetivoPropio | null;
  /** El servidor no ha podido acotar por sede: esta persona no tiene ninguna. */
  sinSede?: boolean;
}

const CELDA_VACIA: Celda = { objetivoId: null, objetivo: null, vendido: 0, consecucion: null };

/**
 * Lo que hay escrito a mano en la casilla. Un objetivo de unidades totales
 * derivado (la suma de los productos) NO se escribe en el campo: se enseña de
 * fondo, para que se vea de dónde sale y para que borrarlo no signifique nada.
 */
function valorFijado(celda: Celda): string {
  if (celda.derivado || celda.objetivo === null) return "";
  return String(celda.objetivo);
}

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

/**
 * Color de la consecución: o se cumple el objetivo (verde) o no se cumple
 * (rojo). Sin tramo ámbar a propósito: quien mira la parrilla busca de un
 * vistazo quién llega y quién no, y un ámbar al 95 % se lee como "va bien"
 * cuando el objetivo sigue sin cumplirse.
 */
function colorConsecucion(v: number | null): string {
  if (v === null) return "text-slate-400";
  if (v >= 100) return "text-emerald-700 font-semibold";
  return "text-rose-600";
}

/** La barra va roja mientras falta y llena en verde al llegar al 100 %. */
function tonoConsecucion(v: number): "success" | "danger" {
  return v >= 100 ? "success" : "danger";
}

/** Lo vendido y la consecución, en pequeño debajo de cada casilla. */
function PieCelda({ vendido, consecucion }: { vendido: number; consecucion: number | null }) {
  return (
    <>
      <span className={`block text-[11px] mt-1 tabular-nums ${colorConsecucion(consecucion)}`}>
        {vendido} uds{consecucion === null ? "" : ` · ${consecucion} %`}
      </span>
      {consecucion !== null && (
        <ProgressBar value={consecucion} tone={tonoConsecucion(consecucion)} className="mt-1" />
      )}
    </>
  );
}

/**
 * Objetivo propio de la coordinadora, arriba del área (ticket 73).
 *
 * No se fija a mano: es el de su zona —la suma de los objetivos de las sedes
 * que lleva frente a lo que esas sedes han vendido—. Debajo, cuántas de sus
 * sedes y cuántas personas de su equipo llegan al 100 %, que es lo que le dice
 * por dónde apretar: un 95 % de zona puede ser "casi" o "dos tiendas sobradas
 * y tres muy lejos".
 */
function MiObjetivo({ datos }: { datos: ObjetivoPropio }) {
  return (
    <Card className="border-[var(--primary)]/30">
      <CardContent className="pt-4 pb-4">
        <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Target className="h-4 w-4 text-[var(--primary)]" /> Mi objetivo
        </p>
        <p className="text-xs text-slate-400 mt-1 max-w-2xl">
          El objetivo de tu zona: la suma de los de tus puntos de venta frente a lo que llevan
          vendido este mes. No se fija a mano, se cumple cuando lo cumplen tus sedes.
        </p>
        <div className="overflow-x-auto mt-3 -mx-6">
          <table className="w-full">
            <thead className="bg-slate-50 border-y border-slate-200">
              <tr>
                {["Objetivo", "Vendido", "Consecución", "Sedes que cumplen", "Mi equipo"].map((h) => (
                  <th
                    key={h}
                    className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-2.5"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-4 py-3 text-lg font-bold tabular-nums text-slate-900">
                  {datos.objetivo}
                </td>
                <td className="px-4 py-3 text-lg font-bold tabular-nums text-slate-900">
                  {datos.vendido}
                </td>
                <td className="px-4 py-3">
                  <Consecucion valor={datos.consecucion} />
                </td>
                <td className="px-4 py-3 text-sm tabular-nums text-slate-600">
                  {datos.sedesConObjetivo === 0
                    ? "—"
                    : `${datos.sedesCumplen} de ${datos.sedesConObjetivo}`}
                </td>
                <td className="px-4 py-3 text-sm tabular-nums text-slate-600">
                  {datos.comercialesConObjetivo === 0
                    ? "—"
                    : `${datos.comercialesCumplen} de ${datos.comercialesConObjetivo}`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** El porcentaje y, debajo, la barra de avance hacia el objetivo. */
function Consecucion({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-sm tabular-nums text-slate-400">—</span>;
  return (
    <div className="min-w-[7rem] space-y-1.5">
      <span className={`text-sm tabular-nums ${colorConsecucion(valor)}`}>{valor} %</span>
      <ProgressBar value={valor} tone={tonoConsecucion(valor)} />
    </div>
  );
}

/**
 * Parrilla de objetivos: filas de sujetos (comerciales o sedes) y una columna
 * por producto. Es el mismo componente para las dos tablas porque las dos se
 * rellenan igual; lo único que cambia es a quién van dirigidos los objetivos.
 */
function TablaObjetivos({
  titulo,
  descripcion,
  icono,
  etiquetaSujeto,
  vacio,
  columnas,
  filas,
  totales,
  soloLectura,
  mostrarSede,
  mes,
  guardando,
  onGuardar,
}: {
  titulo: string;
  descripcion: string;
  icono: ReactNode;
  etiquetaSujeto: string;
  vacio: string;
  columnas: Columna[];
  filas: FilaMatriz[];
  totales: Record<string, TotalColumna>;
  soloLectura: boolean;
  mostrarSede: boolean;
  mes: string;
  guardando: string | null;
  onGuardar: (fila: FilaMatriz, columna: Columna, valor: string) => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-6 pt-4 pb-3">
          <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            {icono} {titulo}
          </p>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">{descripcion}</p>
        </div>
        {filas.length === 0 ? (
          <p className="text-center py-10 text-slate-400 text-sm border-t border-slate-200">{vacio}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-t border-slate-200">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="sticky left-0 z-10 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3 min-w-[13rem]">
                    {etiquetaSujeto}
                  </th>
                  {columnas.map((c) => (
                    <th
                      key={c.id || "total"}
                      className={`text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-3 py-3 min-w-[8rem] ${
                        c.grupo ? "bg-slate-100" : ""
                      }`}
                    >
                      {c.nombre}
                      {c.detalle && (
                        <span className="block font-normal normal-case text-slate-400">{c.detalle}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.sujetoId} className="border-b border-slate-100 last:border-0">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-sm font-medium text-slate-800">
                      {f.sujeto}
                      {mostrarSede && (
                        <span className="block text-xs font-normal text-slate-400">{f.sede ?? "Sin sede"}</span>
                      )}
                    </td>
                    {columnas.map((c) => {
                      const celda = f.celdas[c.id] ?? CELDA_VACIA;
                      const fijado = valorFijado(celda);
                      return (
                        <td
                          key={c.id || "total"}
                          className={`px-3 py-2.5 align-top ${c.grupo ? "bg-slate-50/70" : ""}`}
                        >
                          {soloLectura ? (
                            <span
                              className={`text-sm tabular-nums ${celda.derivado ? "text-slate-500" : ""}`}
                              title={celda.derivado ? "Suma de los objetivos por producto" : undefined}
                            >
                              {celda.objetivo ?? "—"}
                            </span>
                          ) : (
                            <Input
                              // La clave lleva el mes: sin ella, al cambiar de mes
                              // el campo (no controlado) seguiría enseñando la
                              // cifra del mes anterior.
                              key={`${mes}|${f.sujetoId}|${c.id}`}
                              type="number"
                              min="0"
                              step="1"
                              className="w-20 h-9 text-right tabular-nums"
                              defaultValue={fijado}
                              // El total derivado va de fondo: se ve la cifra que
                              // cuenta sin convertirla en un objetivo escrito.
                              placeholder={celda.derivado ? String(celda.objetivo) : "—"}
                              title={
                                celda.derivado
                                  ? "Suma de los objetivos por producto. Escribe un número para fijar otro total."
                                  : undefined
                              }
                              disabled={guardando === `${f.sujetoId}|${c.id}`}
                              aria-label={`Objetivo de ${c.nombre} para ${f.sujeto}`}
                              onBlur={(e) => {
                                const nuevo = e.target.value.trim();
                                if (nuevo !== fijado) onGuardar(f, c, nuevo);
                              }}
                            />
                          )}
                          <PieCelda vendido={celda.vendido} consecucion={celda.consecucion} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td className="sticky left-0 z-10 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Total
                  </td>
                  {columnas.map((c) => {
                    const t = totales[c.id];
                    return (
                      <td
                        key={c.id || "total"}
                        className={`px-3 py-2.5 align-top text-sm tabular-nums ${
                          c.grupo ? "bg-slate-100" : ""
                        }`}
                      >
                        <span className="font-semibold text-slate-800">{t?.objetivo ?? 0}</span>
                        <PieCelda vendido={t?.vendido ?? 0} consecucion={t?.consecucion ?? null} />
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ObjetivosVenta({ mes }: { mes: string }) {
  const { toast } = useToast();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resumenImport, setResumenImport] = useState<ResumenImportacion | null>(null);
  const [gruposAbierto, setGruposAbierto] = useState(false);
  const inputFichero = useRef<HTMLInputElement>(null);

  /**
   * `silencioso` refresca sin enseñar el esqueleto de carga: al guardar una
   * casilla se recargan las cifras, y si la parrilla desaparece y vuelve, el
   * cursor se pierde y no se puede ir rellenando con el tabulador.
   */
  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/objetivos-venta?${new URLSearchParams({ mes })}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "No se han podido cargar los objetivos.");
        setDatos(null);
        return;
      }
      setDatos(data as Respuesta);
    } catch {
      setError("Sin conexión con el servidor.");
      setDatos(null);
    } finally {
      if (!silencioso) setCargando(false);
    }
  }, [mes]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Guarda (o borra, con 0) el objetivo de una casilla. */
  const guardar = async (ambito: Ambito, fila: FilaMatriz, columna: Columna, valor: string) => {
    const limpio = valor.trim();
    const cantidad = limpio === "" ? 0 : Number.parseInt(limpio, 10);
    if (!Number.isInteger(cantidad) || cantidad < 0) {
      toast({ title: "Objetivo no válido", description: "Escribe un número entero de unidades.", variant: "destructive" });
      return;
    }
    setGuardando(`${fila.sujetoId}|${columna.id}`);
    // La columna dice de qué es el objetivo: unidades totales, un grupo de
    // productos (una subcategoría) o un producto suelto.
    try {
      const res = await fetch("/api/objetivos-venta", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mes,
          ambito,
          sujetoId: fila.sujetoId,
          articuloId: columna.grupo || columna.id === COLUMNA_TOTAL ? null : columna.id,
          subcategoria: columna.grupo?.subcategoria ?? null,
          cantidad,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se pudo guardar",
          description: (data as { error?: string }).error ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
        return;
      }
      await cargar(true);
    } catch {
      toast({ title: "Sin conexión", description: "No se ha guardado el objetivo.", variant: "destructive" });
    } finally {
      setGuardando(null);
    }
  };

  /**
   * Descarga la plantilla del mes elegido: la misma parrilla en Excel, ya
   * rellena con lo que hay fijado. Es también la forma de exportar los
   * objetivos para trabajarlos fuera.
   */
  const descargarPlantilla = async () => {
    setDescargando(true);
    try {
      const res = await fetch(`/api/objetivos-venta/plantilla?${new URLSearchParams({ mes })}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({
          title: "No se ha podido generar la plantilla",
          description: (data as { error?: string }).error ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `objetivos_venta_${mes}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Sin conexión", description: "No se ha descargado la plantilla.", variant: "destructive" });
    } finally {
      setDescargando(false);
    }
  };

  /**
   * Sube la plantilla rellena. Se manda el mes que hay en pantalla: el servidor
   * comprueba que coincide con el que trae la hoja para no volcar los objetivos
   * de un mes encima de los de otro.
   */
  const importarPlantilla = async (fichero: File) => {
    setImportando(true);
    setResumenImport(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("No se ha podido leer el archivo"));
        fr.readAsDataURL(fichero);
      });

      const res = await fetch("/api/objetivos-venta/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, nombreFichero: fichero.name, contenidoBase64: base64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se ha podido importar",
          description: (data as { error?: string }).error ?? "Revisa el archivo e inténtalo de nuevo.",
          variant: "destructive",
        });
        return;
      }
      const resumen = data as ResumenImportacion;
      setResumenImport(resumen);
      toast({
        title: "Objetivos importados",
        description: `${resumen.creados} nuevos, ${resumen.actualizados} actualizados${
          resumen.borrados ? `, ${resumen.borrados} quitados` : ""
        }.`,
      });
      await cargar(true);
    } catch (err) {
      toast({
        title: "Error al subir",
        description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setImportando(false);
      if (inputFichero.current) inputFichero.current.value = "";
    }
  };

  const quitar = async (id: string) => {
    const res = await fetch(`/api/objetivos-venta?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({
        title: "No se pudo quitar",
        description: (data as { error?: string }).error ?? "",
        variant: "destructive",
      });
      return;
    }
    await cargar(true);
  };

  const soloLectura = datos?.soloLectura ?? true;
  // Unidades totales siempre delante: es el objetivo "de todo" y el que ve el
  // comercial en su cierre. Después los grupos, que es como el cliente piensa
  // los objetivos, y al final el catálogo en su orden de configuración.
  const columnas = useMemo<Columna[]>(
    () => [
      { id: COLUMNA_TOTAL, nombre: "Unidades totales", detalle: null },
      ...(datos?.subgrupos ?? []).map((g) => ({
        id: g.id,
        nombre: g.subcategoria,
        // Una columna por subcategoría y ya está: la categoría (Particular,
        // Empresa) no parte el objetivo, sus productos suman todos aquí.
        detalle: "Grupo de productos",
        grupo: g,
      })),
      ...(datos?.articulos ?? []).map((a) => ({
        id: a.id,
        nombre: a.nombre,
        // Dónde está el producto, que es lo que distingue dos que se llaman
        // igual en bloques distintos.
        detalle: [a.categoria, a.subcategoria].filter(Boolean).join(" → ") || null,
      })),
    ],
    [datos],
  );
  const resumen = datos?.resumen;
  const consecucionGlobal =
    resumen && resumen.objetivo > 0
      ? Math.round((resumen.vendido / resumen.objetivo) * 1000) / 10
      : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-4 pb-4">
          {/* El mes NO se elige aquí: lo manda el área, que es común a esta
              subárea y al seguimiento (ticket 82). Aquí solo lo que actúa sobre
              la parrilla del mes que ya venga elegido. */}
          <div className="flex items-end gap-4 flex-wrap">
            {/* Excel: la parrilla entera de un mes se rellena mucho más rápido
                fuera, y la hoja baja ya con lo que hay fijado. */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" disabled={descargando} onClick={() => void descargarPlantilla()}>
                <Download className="h-4 w-4 mr-2" />
                {descargando ? "Preparando…" : "Descargar plantilla"}
              </Button>
              {!soloLectura && (
                <>
                  <input
                    ref={inputFichero}
                    type="file"
                    accept=".xlsx,.xls,.csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void importarPlantilla(f);
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={importando}
                    onClick={() => inputFichero.current?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {importando ? "Importando…" : "Importar objetivos"}
                  </Button>
                  {/* Los grupos se montan desde aquí: quien está rellenando la
                      parrilla es quien se da cuenta de que le falta uno. */}
                  <Button variant="outline" onClick={() => setGruposAbierto(true)}>
                    <Layers className="h-4 w-4 mr-2" />
                    Grupos de objetivos
                  </Button>
                </>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-400 mt-3 max-w-3xl">
            <strong className="font-medium text-slate-500">Con Excel:</strong> descarga la plantilla
            del mes elegido —baja con una fila por comercial, por punto de venta y por grupo, y una
            columna por grupo de productos y por producto, ya con los objetivos que tengas
            puestos—, rellénala y vuelve a subirla. Una casilla en blanco se deja como está; para
            quitar un objetivo, escribe 0.
          </p>
          <p className="text-xs text-slate-400 mt-3 max-w-3xl">
            Cada casilla es el objetivo de unidades del mes elegido. Debajo de la casilla verás lo
            que se lleva vendido y la consecución. Hay tres tablas y son independientes entre sí:
            la de cada comercial, la de cada punto de venta —que se compara con lo que vende la
            sede completa, no con la suma de los de su equipo— y la de los{" "}
            <strong className="font-medium text-slate-500">grupos de objetivos</strong> que montes
            tú (TMT, televenta…), que se compara con lo que venden sus miembros.
          </p>
          <p className="text-xs text-slate-400 mt-2 max-w-3xl">
            <strong className="font-medium text-slate-500">Unidades totales</strong> es la suma de
            lo que pongas por grupo y por producto suelto en esa fila (aparece en gris). Si quieres
            otro total —por ejemplo, para contar también lo que no tiene columna propia— escríbelo
            encima y manda el tuyo; bórralo y vuelve a mandar la suma.
          </p>
          <p className="text-xs text-slate-400 mt-2 max-w-3xl">
            Cada objetivo puede ir de dos formas: sobre un{" "}
            <strong className="font-medium text-slate-500">producto suelto</strong> o sobre un{" "}
            <strong className="font-medium text-slate-500">grupo de productos</strong> (las columnas
            grises, una por subcategoría del catálogo). Tu equipo sigue registrando cada producto por
            separado; para el objetivo de grupo se suman las unidades de todos los productos de esa
            subcategoría, cuelguen de la categoría que cuelguen: si tienes FFTH en Particular y en
            Empresa, las dos empujan el mismo objetivo de FFTH. Las categorías no llevan objetivo
            propio —organizan el catálogo, filtran los informes y las elige tu equipo al registrar
            la venta. Si un producto
            ya tiene objetivo propio dentro de un grupo con objetivo, no se suma dos veces en las
            unidades totales: manda el del grupo.
          </p>
          {/* Lo que el cliente ha dejado fuera a propósito. Sin decirlo, un
              producto sin columna parece un fallo del catálogo. */}
          {(datos?.excluidos.length ?? 0) > 0 && (
            <p className="text-xs text-slate-400 mt-2 max-w-3xl">
              No cuentan para ningún objetivo: {datos?.excluidos.join(", ")}. Se siguen vendiendo y
              registrando en el cierre; simplemente no suman.{" "}
              {!soloLectura && (
                <a href="/admin/configuracion?tab=catalogo" className="underline font-medium">
                  Cambiar cuáles cuentan
                </a>
              )}
            </p>
          )}
          {/* Sin catálogo solo hay columna de unidades totales: hay que decir
              dónde se definen los productos, o el objetivo por producto parece
              que no existe. Si los hay pero están todos excluidos, lo explica el
              párrafo de arriba y este avisaría de algo que no es verdad. */}
          {!soloLectura &&
            (datos?.articulos.length ?? 0) === 0 &&
            (datos?.excluidos.length ?? 0) === 0 && (
              <p className="text-xs text-amber-700 mt-2">
                Todavía no tienes productos en el catálogo, así que solo puedes fijar objetivos de
                unidades totales. Añádelos en{" "}
                <a href="/admin/configuracion?tab=catalogo" className="underline font-medium">
                  Configuración → Catálogo de ventas
                </a>{" "}
                (pospago, fibra, renove…) y aparecerá una columna por producto y otra por cada
                subcategoría.
              </p>
            )}
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* Qué ha hecho la última importación. Se queda en pantalla hasta la
          siguiente: es lo que permite repasar lo que no se ha podido leer. */}
      {resumenImport && (
        <Card>
          <CardContent className="pt-4 pb-4 text-sm space-y-2">
            <p className="font-medium text-slate-800 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-slate-400" />
              Resultado de la importación ({resumenImport.mes})
            </p>
            <p className="text-slate-600">
              {resumenImport.creados} nuevos · {resumenImport.actualizados} actualizados ·{" "}
              {resumenImport.borrados} quitados · {resumenImport.sinCambios} sin cambios
            </p>
            {resumenImport.columnasIgnoradas.length > 0 && (
              <div>
                <p className="text-amber-700">Columnas que no hemos podido usar:</p>
                <ul className="mt-1 space-y-0.5 text-slate-500">
                  {resumenImport.columnasIgnoradas.map((c) => (
                    <li key={c.columna}>
                      {c.columna}: {c.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {resumenImport.totalIgnoradas > 0 && (
              <div>
                <p className="text-amber-700">
                  {resumenImport.totalIgnoradas} casilla
                  {resumenImport.totalIgnoradas === 1 ? "" : "s"} sin importar:
                </p>
                <ul className="mt-1 space-y-0.5 text-slate-500">
                  {resumenImport.ignoradas.map((ig, i) => (
                    <li key={`${ig.fila}-${i}`}>
                      Fila {ig.fila}: {ig.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Lo primero que ve la coordinadora es su propio objetivo; debajo, el
          detalle de su gente y sus sedes. */}
      {datos?.objetivoPropio && <MiObjetivo datos={datos.objetivoPropio} />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        {[
          { label: "Objetivo del mes", valor: String(resumen?.objetivo ?? 0), color: "text-slate-900", barra: null },
          { label: "Vendido", valor: String(resumen?.vendido ?? 0), color: "text-slate-900", barra: null },
          {
            label: "Consecución",
            valor: consecucionGlobal === null ? "—" : `${consecucionGlobal} %`,
            color: colorConsecucion(consecucionGlobal),
            barra: consecucionGlobal,
          },
          {
            label: "Comerciales con objetivo",
            valor: String(resumen?.conObjetivo ?? 0),
            color: "text-[var(--primary)]",
            barra: null,
          },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-slate-500">{k.label}</p>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${k.color}`}>{k.valor}</p>
              {k.barra !== null && (
                <ProgressBar
                  value={k.barra}
                  tone={tonoConsecucion(k.barra)}
                  size="md"
                  className="mt-2"
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-slate-400 -mt-3">
        Estas cuatro cifras resumen el objetivo de unidades totales de los comerciales (el que
        pongas a mano o, si no, la suma de sus productos). El total de cada producto y el de las
        sedes están al pie de su tabla.
      </p>

      {cargando ? (
        <Card>
          <CardContent className="p-4 space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </CardContent>
        </Card>
      ) : datos?.sinSede ? (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-center py-10 text-slate-500 text-sm max-w-md mx-auto">
              No tienes ninguna sede asignada, así que no hay objetivos que consultar. Pídele a
              administración que te asigne tu punto de venta.
            </p>
          </CardContent>
        </Card>
      ) : !datos ? null : (
        <>
          <TablaObjetivos
            titulo="Objetivos por comercial"
            descripcion="Lo que tiene que vender cada persona este mes, producto a producto."
            icono={<Users className="h-4 w-4 text-[var(--primary)]" />}
            etiquetaSujeto="Comercial"
            vacio="No hay empleados activos a los que fijar objetivo."
            columnas={columnas}
            filas={datos?.filasComerciales ?? []}
            totales={datos?.totalesComerciales ?? {}}
            soloLectura={soloLectura}
            mostrarSede
            mes={mes}
            guardando={guardando}
            onGuardar={(fila, columna, valor) => void guardar("comercial", fila, columna, valor)}
          />

          <TablaObjetivos
            titulo="Objetivos por punto de venta"
            descripcion="El objetivo de la sede entera, producto a producto. Es independiente del de cada comercial."
            icono={<Building2 className="h-4 w-4 text-[var(--primary)]" />}
            etiquetaSujeto="Punto de venta"
            vacio="No hay puntos de venta activos."
            columnas={columnas}
            filas={datos?.filasSedes ?? []}
            totales={datos?.totalesSedes ?? {}}
            soloLectura={soloLectura}
            mostrarSede={false}
            mes={mes}
            guardando={guardando}
            onGuardar={(fila, columna, valor) => void guardar("sede", fila, columna, valor)}
          />

          {/* Los grupos del cliente (TMT, televenta…). Sin ninguno dado de alta
              la tabla explica de qué va, en vez de aparecer vacía sin más. */}
          <TablaObjetivos
            titulo="Objetivos por grupo"
            descripcion="El objetivo de un grupo tuyo (TMT, televenta…): se cumple con lo que venden sus miembros, contando cada venta una sola vez. Es independiente de los objetivos de cada comercial y de cada sede."
            icono={<Layers className="h-4 w-4 text-[var(--primary)]" />}
            etiquetaSujeto="Grupo"
            vacio={
              soloLectura
                ? "No hay ningún grupo de objetivos que te corresponda."
                : 'Todavía no tienes grupos. Créalos en "Grupos de objetivos" y aparecerán aquí.'
            }
            columnas={columnas}
            filas={datos?.filasGrupos ?? []}
            totales={datos?.totalesGrupos ?? {}}
            soloLectura={soloLectura}
            mostrarSede
            mes={mes}
            guardando={guardando}
            onGuardar={(fila, columna, valor) => void guardar("grupo", fila, columna, valor)}
          />
        </>
      )}

      {/* Alta y edición de los grupos; al cerrar se recarga si algo cambió. */}
      {!soloLectura && (
        <GruposObjetivoDialog
          abierto={gruposAbierto}
          onClose={(huboCambios) => {
            setGruposAbierto(false);
            if (huboCambios) void cargar(true);
          }}
        />
      )}

      {!soloLectura && (
        <p className="text-xs text-slate-400">
          Cada objetivo se guarda al salir de la casilla. Déjala vacía o escribe 0 para quitarlo.
        </p>
      )}

      {/* Todos los objetivos del mes en una sola lista: es la vista para
          repasar lo fijado y quitar de un tirón lo que sobre. */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <p className="text-sm font-semibold text-slate-800 flex items-center gap-2 mb-3">
            <Target className="h-4 w-4 text-[var(--primary)]" /> Todos los objetivos de este mes
          </p>
          {(datos?.objetivosDelMes.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-400 py-4">
              Todavía no hay ningún objetivo fijado para este mes.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-6">
              <table className="w-full">
                <thead className="bg-slate-50 border-y border-slate-200">
                  <tr>
                    {[
                      "Ámbito",
                      "Comercial, sede o grupo",
                      "Producto o grupo de productos",
                      "Objetivo",
                      "Vendido",
                      ...(datos?.preciosActivos ? ["Importe"] : []),
                      "Consecución",
                      "",
                    ].map((h, i) => (
                      <th
                        key={`${h}-${i}`}
                        className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-2.5"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos?.objetivosDelMes.map((o) => (
                    <tr key={o.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 text-sm text-slate-500">
                        {o.ambito === "sede" ? "Sede" : o.ambito === "grupo" ? "Grupo" : "Comercial"}
                      </td>
                      <td className="px-4 py-2 text-sm font-medium text-slate-800">{o.sujeto}</td>
                      <td className="px-4 py-2 text-sm text-slate-500">
                        {o.articulo ?? (o.grupo ? `Grupo: ${o.grupo}` : "Unidades totales")}
                      </td>
                      <td className="px-4 py-2 text-sm tabular-nums">{o.objetivo}</td>
                      <td className="px-4 py-2 text-sm tabular-nums">{o.vendido}</td>
                      {datos?.preciosActivos && (
                        <td className="px-4 py-2 text-sm tabular-nums text-slate-600">
                          {o.importe === null ? "—" : eur(o.importe)}
                        </td>
                      )}
                      <td className="px-4 py-2">
                        <Consecucion valor={o.consecucion} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        {!soloLectura && (
                          <Button variant="ghost" size="sm" onClick={() => void quitar(o.id)}>
                            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Quitar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-slate-500 max-w-2xl flex items-start gap-2">
        <TrendingUp className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
        <span>
          Lo vendido sale de los cierres de turno del mes, contando cada venta en la sede donde
          se hizo. Es distinto del área <strong>Objetivos (OKRs)</strong> de recursos humanos, que
          sigue sirviendo para objetivos con avance manual.
        </span>
      </p>
    </div>
  );
}
