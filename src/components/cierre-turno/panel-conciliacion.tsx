"use client";

/**
 * Conciliación: los dos cuadres del módulo, por punto de venta.
 *
 *   efectivo de los cierres  ↔  efectivo declarado en los arqueos
 *   tarjeta de los cierres   ↔  ingresos del banco importados del extracto
 *
 * Criterio de la pantalla: distinguir "descuadre" de "falta el dato". Si una
 * sede no ha declarado arqueo, la diferencia no es un descuadre — es que no hay
 * con qué comparar, y decir lo contrario hace que nadie se crea la pantalla.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, HelpCircle, Upload } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface Fila {
  tiendaId: string;
  sede: string;
  cajas: number;
  efectivo: {
    segunCierres: number;
    segunArqueos: number;
    recogido: number;
    arqueos: number;
    diferencia: number;
    descuadre: boolean;
    sinArqueos: boolean;
  };
  facturacion: {
    segunCierres: number;
    segunFacturacion: number;
    lineas: number;
    diferencia: number;
    descuadre: boolean;
    sinFacturacion: boolean;
  };
  tarjeta: {
    segunCierres: number;
    segunBanco: number;
    movimientos: number;
    diferencia: number;
    descuadre: boolean;
    sinBanco: boolean;
  };
}

interface Conciliacion {
  desde: string;
  hasta: string;
  semanas: string[];
  umbral: number;
  filas: Fila[];
  bancoSinSede: { importe: number; n: number };
  cajaSinSede: { efectivo: number; tarjeta: number; cajas: number };
  totales: {
    efectivoCierres: number;
    efectivoArqueos: number;
    tarjetaCierres: number;
    tarjetaBanco: number;
    descuadres: number;
  };
}

/** Los dos ficheros externos que se importan aquí. */
type FuenteImport = "banco" | "facturacion";

interface Previsualizacion {
  cabeceras: string[];
  filas: string[][];
  mapeo: {
    fecha: number;
    importe: number;
    concepto: number | null;
    referencia: number | null;
    formatoFecha: "dmy" | "mdy" | "ymd";
    conCabecera: boolean;
  };
  mapeoDe: "guardado" | "propuesto";
  muestra: { fecha: string; importe: number; concepto: string | null }[];
  problemasMuestra: { fila: number; motivo: string }[];
}

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

function primerDiaDeMes(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-01`;
}

function hoyMadrid(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

export function PanelConciliacion() {
  const { toast } = useToast();
  const [desde, setDesde] = useState(primerDiaDeMes());
  const [hasta, setHasta] = useState(hoyMadrid());
  const [tiendaId, setTiendaId] = useState("");
  const [sedes, setSedes] = useState<{ id: string; nombre: string }[]>([]);
  const [datos, setDatos] = useState<Conciliacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Importación del extracto
  const inputFichero = useRef<HTMLInputElement>(null);
  const [fichero, setFichero] = useState<{ nombre: string; base64: string } | null>(null);
  const [previa, setPrevia] = useState<Previsualizacion | null>(null);
  const [mapeo, setMapeo] = useState<Previsualizacion["mapeo"] | null>(null);
  const [sedeImport, setSedeImport] = useState("");
  const [fuenteImport, setFuenteImport] = useState<FuenteImport>("banco");
  const [subiendo, setSubiendo] = useState(false);
  const [recordarMapeo, setRecordarMapeo] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams({ desde, hasta });
      if (tiendaId) params.set("tiendaId", tiendaId);
      const res = await fetch(`/api/conciliacion?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "No se ha podido cargar la conciliación.");
        setDatos(null);
        return;
      }
      setDatos(data as Conciliacion);
    } catch {
      setError("Sin conexión con el servidor.");
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, tiendaId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    fetch("/api/tiendas")
      .then((r) => r.json())
      .then((d) => setSedes(d.tiendas ?? []))
      .catch(() => setSedes([]));
  }, []);

  /**
   * Qué fichero se está subiendo. Los dos circuitos son iguales —previsualizar,
   * confirmar columnas, importar sin duplicar— y solo cambia el endpoint, así
   * que comparten pantalla (ticket 4b8e1d05).
   */
  const fuenteEs = (f: FuenteImport) => (f === "banco" ? "el extracto del banco" : "la facturación");

  /** Paso 1 de la importación: leer el fichero y proponer el mapeo. */
  const elegirFichero = async (f: File) => {
    setSubiendo(true);
    setPrevia(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("No se ha podido leer el archivo"));
        fr.readAsDataURL(f);
      });
      setFichero({ nombre: f.name, base64 });

      const res = await fetch(`/api/movimientos-${fuenteImport}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombreFichero: f.name,
          contenidoBase64: base64,
          tiendaId: sedeImport || null,
          previsualizar: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: `No se ha podido leer ${fuenteEs(fuenteImport)}`,
          description: (data as { error?: string }).error ?? "",
          variant: "destructive",
        });
        return;
      }
      const p = data as Previsualizacion;
      setPrevia(p);
      setMapeo(p.mapeo);
    } catch (err) {
      toast({
        title: "Error al leer el archivo",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setSubiendo(false);
      if (inputFichero.current) inputFichero.current.value = "";
    }
  };

  /** Paso 2: importar de verdad con el mapeo confirmado. */
  const importar = async () => {
    if (!fichero || !mapeo) return;
    setSubiendo(true);
    try {
      const res = await fetch(`/api/movimientos-${fuenteImport}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombreFichero: fichero.nombre,
          contenidoBase64: fichero.base64,
          tiendaId: sedeImport || null,
          mapeo,
          guardarMapeo: recordarMapeo,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se ha importado",
          description: (data as { error?: string }).error ?? "",
          variant: "destructive",
        });
        return;
      }
      const r = data as { importados: number; yaEstaban: number; totalIgnoradas: number; importe: number };
      toast({
        title: fuenteImport === "banco" ? "Extracto importado" : "Facturación importada",
        description: `${r.importados} movimientos nuevos (${eur(r.importe)})${
          r.yaEstaban ? `, ${r.yaEstaban} ya estaban` : ""
        }${r.totalIgnoradas ? `, ${r.totalIgnoradas} filas sin importar` : ""}.`,
      });
      setPrevia(null);
      setFichero(null);
      await cargar();
    } finally {
      setSubiendo(false);
    }
  };

  const t = datos?.totales;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Conciliación</h1>
        <p className="text-slate-500 text-sm mt-1 max-w-2xl">
          Cuadra el efectivo de los cierres con los arqueos, y los cobros con datáfono con los
          ingresos del banco.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <Label htmlFor="conc-desde">Desde</Label>
              <Input
                id="conc-desde"
                type="date"
                className="mt-1 w-40"
                value={desde}
                max={hasta}
                onChange={(e) => setDesde(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="conc-hasta">Hasta</Label>
              <Input
                id="conc-hasta"
                type="date"
                className="mt-1 w-40"
                value={hasta}
                min={desde}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
            {sedes.length > 1 && (
              <div>
                <Label htmlFor="conc-sede">Punto de venta</Label>
                <select
                  id="conc-sede"
                  className="mt-1 w-48 rounded-md border border-slate-200 px-3 py-2 text-sm"
                  value={tiendaId}
                  onChange={(e) => setTiendaId(e.target.value)}
                >
                  <option value="">Todas las sedes</option>
                  {sedes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {datos && (
            <p className="text-xs text-slate-400 mt-3">
              Los arqueos se comparan por semanas completas ({datos.semanas.join(", ")}), que es su
              unidad. Umbral de descuadre: {eur(datos.umbral)}.
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        {[
          { label: "Efectivo en cierres", valor: t ? eur(t.efectivoCierres) : "—", color: "text-slate-900" },
          { label: "Efectivo en arqueos", valor: t ? eur(t.efectivoArqueos) : "—", color: "text-slate-900" },
          { label: "Tarjeta en cierres", valor: t ? eur(t.tarjetaCierres) : "—", color: "text-slate-900" },
          {
            label: "Ingresos del banco",
            valor: t ? eur(t.tarjetaBanco) : "—",
            color: "text-[var(--primary)]",
          },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-slate-500">{k.label}</p>
              <p className={`text-xl font-bold mt-1 tabular-nums ${k.color}`}>{k.valor}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {cargando ? (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 bg-slate-100 rounded animate-pulse" />
            ))}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {datos?.filas.map((f) => (
            <Card key={f.tiendaId}>
              <CardContent className="pt-4 pb-4">
                <p className="font-semibold text-slate-900">{f.sede}</p>
                <div className="grid md:grid-cols-3 gap-4 mt-3">
                  <Cuadre
                    titulo="Efectivo"
                    href={`/admin/conciliacion/efectivo/${f.tiendaId}?desde=${desde}&hasta=${hasta}`}
                    izquierda={{ label: "Según cierres", valor: f.efectivo.segunCierres }}
                    derecha={{ label: "Según arqueos", valor: f.efectivo.segunArqueos }}
                    diferencia={f.efectivo.diferencia}
                    descuadre={f.efectivo.descuadre}
                    faltaDato={f.efectivo.sinArqueos}
                    textoFalta="Esta sede no ha declarado ningún arqueo en estas semanas, así que no hay con qué cuadrar el efectivo."
                  />
                  <Cuadre
                    titulo="Tarjeta"
                    href={`/admin/conciliacion/tarjeta/${f.tiendaId}?desde=${desde}&hasta=${hasta}`}
                    izquierda={{ label: "Según cierres", valor: f.tarjeta.segunCierres }}
                    derecha={{ label: "Según banco", valor: f.tarjeta.segunBanco }}
                    diferencia={f.tarjeta.diferencia}
                    descuadre={f.tarjeta.descuadre}
                    faltaDato={f.tarjeta.sinBanco}
                    textoFalta="No hay movimientos del banco de esta sede en el periodo. Importa el extracto para poder cuadrar."
                  />
                  {/* La tercera pata (ticket 4b8e1d05): los otros dos cuadres
                      comprueban que el dinero está; este, que la venta se
                      tramitó en el sistema del operador. */}
                  <Cuadre
                    titulo="Facturado"
                    href={`/admin/conciliacion/facturacion/${f.tiendaId}?desde=${desde}&hasta=${hasta}`}
                    izquierda={{ label: "Cobrado en cierres", valor: f.facturacion.segunCierres }}
                    derecha={{ label: "Consta facturado", valor: f.facturacion.segunFacturacion }}
                    diferencia={f.facturacion.diferencia}
                    descuadre={f.facturacion.descuadre}
                    faltaDato={f.facturacion.sinFacturacion}
                    textoFalta="No hay líneas de facturación de esta sede en el periodo. Sube el Excel del sistema de facturación para poder cuadrar."
                  />
                </div>
              </CardContent>
            </Card>
          ))}

          {(datos?.cajaSinSede.cajas ?? 0) > 0 && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600 flex items-start gap-2">
              <HelpCircle className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
              <span>
                Hay {datos?.cajaSinSede.cajas} cierres de caja de gente sin sede asignada
                ({eur(datos?.cajaSinSede.efectivo ?? 0)} en efectivo y{" "}
                {eur(datos?.cajaSinSede.tarjeta ?? 0)} con tarjeta) que no aparecen en ninguna fila
                de arriba. Asigna sede a esas personas en Empleados para que entren en los cuadres.
              </span>
            </div>
          )}

          {(datos?.bancoSinSede.n ?? 0) > 0 && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600 flex items-start gap-2">
              <HelpCircle className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
              <span>
                Hay {datos?.bancoSinSede.n} movimientos del banco por {eur(datos?.bancoSinSede.importe ?? 0)}{" "}
                sin sede asignada: no se pueden atribuir a ninguna tienda y quedan fuera de los
                cuadres de arriba. Al importar el extracto, indica de qué sede es.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Importación del extracto, con confirmación del mapeo de columnas. */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Extracto del banco</p>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Sube el Excel o el CSV que te da tu banco. Como cada banco lo exporta a su manera, te
              enseñamos las primeras filas para que confirmes qué columna es la fecha y cuál el
              importe. Se recuerda para la próxima vez, y volver a subir el mismo extracto no
              duplica nada.
            </p>
          </div>

          <div className="flex items-end gap-3 flex-wrap">
            {sedes.length > 1 && (
              <div>
                <Label htmlFor="import-sede">¿De qué sede es este extracto?</Label>
                <select
                  id="import-sede"
                  className="mt-1 w-48 rounded-md border border-slate-200 px-3 py-2 text-sm"
                  value={sedeImport}
                  onChange={(e) => setSedeImport(e.target.value)}
                >
                  <option value="">Sin asignar</option>
                  {sedes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <Label htmlFor="fuente-import">Qué fichero subes</Label>
              <select
                id="fuente-import"
                className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm"
                value={fuenteImport}
                onChange={(e) => {
                  setFuenteImport(e.target.value as FuenteImport);
                  // El mapeo de columnas es de cada fichero: al cambiar de
                  // fuente, la previsualización anterior ya no vale.
                  setPrevia(null);
                  setFichero(null);
                }}
              >
                <option value="banco">Extracto del banco</option>
                <option value="facturacion">Facturación del operador</option>
              </select>
            </div>
            <input
              ref={inputFichero}
              type="file"
              accept=".xlsx,.xls,.csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void elegirFichero(f);
              }}
            />
            <Button disabled={subiendo} onClick={() => inputFichero.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              {subiendo ? "Leyendo…" : "Elegir fichero"}
            </Button>
          </div>

          {previa && mapeo && (
            <div className="rounded-md border border-slate-200 p-3 space-y-3">
              <p className="text-sm text-slate-700">
                {previa.mapeoDe === "guardado"
                  ? "Usamos el mapeo que guardaste la última vez. Compruébalo con estas filas:"
                  : "Esto es lo que hemos entendido del fichero. Corrige lo que no cuadre:"}
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {previa.filas.map((f, i) => (
                      <tr key={i} className={i === 0 && mapeo.conCabecera ? "font-semibold text-slate-600" : ""}>
                        {f.map((c, j) => (
                          <td key={j} className="border border-slate-100 px-2 py-1 whitespace-nowrap">
                            {c || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {(
                  [
                    { campo: "fecha" as const, label: "Columna de la fecha", obligatorio: true },
                    { campo: "importe" as const, label: "Columna del importe", obligatorio: true },
                    { campo: "concepto" as const, label: "Columna del concepto", obligatorio: false },
                    { campo: "referencia" as const, label: "Columna de la referencia", obligatorio: false },
                  ]
                ).map(({ campo, label, obligatorio }) => (
                  <div key={campo}>
                    <Label htmlFor={`map-${campo}`}>{label}</Label>
                    <select
                      id={`map-${campo}`}
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                      value={mapeo[campo] === null ? "" : String(mapeo[campo])}
                      onChange={(e) =>
                        setMapeo((m) =>
                          m
                            ? {
                                ...m,
                                [campo]: e.target.value === "" ? null : Number.parseInt(e.target.value, 10),
                              }
                            : m,
                        )
                      }
                    >
                      {!obligatorio && <option value="">No la tiene</option>}
                      {previa.cabeceras.map((c, i) => (
                        <option key={i} value={i}>
                          {c || `Columna ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <div>
                  <Label htmlFor="map-formato">Formato de la fecha</Label>
                  <select
                    id="map-formato"
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                    value={mapeo.formatoFecha}
                    onChange={(e) =>
                      setMapeo((m) =>
                        m ? { ...m, formatoFecha: e.target.value as "dmy" | "mdy" | "ymd" } : m,
                      )
                    }
                  >
                    <option value="dmy">Día/mes/año (31/07/2026)</option>
                    <option value="mdy">Mes/día/año (07/31/2026)</option>
                    <option value="ymd">Año/mes/día (2026/07/31)</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={mapeo.conCabecera}
                      onChange={(e) => setMapeo((m) => (m ? { ...m, conCabecera: e.target.checked } : m))}
                    />
                    La primera fila es el encabezado
                  </label>
                </div>
              </div>

              {previa.muestra.length > 0 && (
                <div className="text-xs text-slate-600">
                  <p className="font-medium text-slate-700 mb-1">Así lo vamos a leer:</p>
                  <ul className="space-y-0.5">
                    {previa.muestra.map((m, i) => (
                      <li key={i} className="tabular-nums">
                        {m.fecha} · {eur(m.importe)} · {m.concepto ?? "sin concepto"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {previa.problemasMuestra.length > 0 && (
                <p className="text-xs text-amber-700">
                  Filas que quedarían fuera:{" "}
                  {previa.problemasMuestra.map((p) => `${p.fila} (${p.motivo})`).join(", ")}.
                </p>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={recordarMapeo}
                    onChange={(e) => setRecordarMapeo(e.target.checked)}
                  />
                  Recordar este mapeo para los próximos extractos
                </label>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPrevia(null);
                      setFichero(null);
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button size="sm" disabled={subiendo} onClick={() => void importar()}>
                    {subiendo ? "Importando…" : "Importar movimientos"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-slate-500 max-w-2xl">
        El cuadre de tarjeta compara el periodo completo, no movimiento a movimiento: las
        liquidaciones del datáfono entran en el banco con uno o dos días de retraso, así que en un
        rango corto una diferencia puede ser solo desfase. Amplía el periodo antes de dar por bueno
        un descuadre.
      </p>
    </div>
  );
}

/** Un cuadre: dos importes, su diferencia y qué significa. */
/**
 * Un cuadre de una tienda. Es un ENLACE al detalle (ticket 1e73c9a4): "no
 * cuadra" sin poder abrir qué día ni qué movimiento falla no sirve de nada.
 */
function Cuadre({
  titulo,
  href,
  izquierda,
  derecha,
  diferencia,
  descuadre,
  faltaDato,
  textoFalta,
}: {
  titulo: string;
  href: string;
  izquierda: { label: string; valor: number };
  derecha: { label: string; valor: number };
  diferencia: number;
  descuadre: boolean;
  faltaDato: boolean;
  textoFalta: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-md border border-slate-200 p-3 hover:border-[var(--primary)] hover:bg-slate-50 transition-colors"
    >
      <p className="text-sm font-medium text-slate-700 flex items-center justify-between gap-2">
        {titulo}
        <ChevronRight className="h-4 w-4 text-slate-400" />
      </p>
      <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
        <div>
          <p className="text-slate-500 text-xs">{izquierda.label}</p>
          <p className="font-semibold tabular-nums">{eur(izquierda.valor)}</p>
        </div>
        <div>
          <p className="text-slate-500 text-xs">{derecha.label}</p>
          <p className="font-semibold tabular-nums">{eur(derecha.valor)}</p>
        </div>
      </div>
      {faltaDato ? (
        <p className="mt-2 text-xs text-slate-500 flex items-start gap-1.5">
          <HelpCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" />
          {textoFalta}
        </p>
      ) : descuadre ? (
        <p className="mt-2 text-xs text-amber-700 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Descuadre de {eur(diferencia)}.
        </p>
      ) : (
        <p className="mt-2 text-xs text-emerald-700 flex items-start gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Cuadra{diferencia !== 0 ? ` (diferencia de ${eur(diferencia)}, por debajo del umbral)` : ""}.
        </p>
      )}
    </Link>
  );
}
