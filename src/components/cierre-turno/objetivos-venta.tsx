"use client";

/**
 * Objetivos de venta del mes. La misma pantalla para administración (fija los
 * objetivos) y para coordinación (los consulta, de su sede): quién puede
 * escribir lo decide el servidor y llega en `soloLectura`.
 *
 * Forma de trabajar: se elige el mes, si el objetivo es de comerciales o de
 * sedes, y sobre qué (unidades totales o un artículo concreto). La tabla
 * enseña una fila por comercial —o por sede— con su objetivo editable al lado
 * de lo que lleva vendido. Así se reparte un objetivo en un minuto en vez de
 * abrir un formulario por persona.
 *
 * Cada casilla se guarda al salir del campo. Poner 0 quita el objetivo: es lo
 * que la gente hace de forma natural para "quitar esto", y pedirle un botón de
 * borrar aparte sería trabajo de más.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Target, Trash2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useToast } from "@/hooks/use-toast";

type Ambito = "comercial" | "sede";

interface Articulo {
  id: string;
  nombre: string;
  categoria: string | null;
  precio: number | null;
}

interface Fila {
  sujetoId: string;
  sujeto: string;
  sede: string | null;
  objetivoId: string | null;
  objetivo: number | null;
  vendido: number;
  consecucion: number | null;
  importe: number | null;
}

interface ObjetivoDelMes {
  id: string;
  ambito: Ambito;
  sujeto: string;
  articulo: string | null;
  objetivo: number;
  vendido: number;
  consecucion: number | null;
}

interface Respuesta {
  mes: string;
  ambito: Ambito;
  articuloId: string | null;
  soloLectura: boolean;
  preciosActivos: boolean;
  articulos: Articulo[];
  sedes: { id: string; nombre: string }[];
  filas: Fila[];
  objetivosDelMes: ObjetivoDelMes[];
  resumen: { objetivo: number; vendido: number; conObjetivo: number };
  /** El servidor no ha podido acotar por sede: esta persona no tiene ninguna. */
  sinSede?: boolean;
}

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

/** Mes en curso como "YYYY-MM" en horario peninsular. */
function mesActual(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}`;
}

/**
 * Color de la consecución: solo hay dos estados, objetivo cumplido (verde) o no
 * cumplido (rojo). Sin tramo intermedio a propósito: quien mira la tabla busca
 * de un vistazo quién llega y quién no, y un ámbar al 95 % se lee como "va
 * bien" cuando el objetivo sigue sin cumplirse.
 */
function colorConsecucion(v: number | null): string {
  if (v === null) return "text-slate-400";
  if (v >= 100) return "text-emerald-700 font-semibold";
  return "text-rose-600";
}

/**
 * Consecución de una fila: el porcentaje y, debajo, la barra de avance hacia el
 * objetivo. La barra va roja mientras falta y se llena entera en verde al
 * llegar al 100 % (por encima se queda llena, no se sale).
 */
function Consecucion({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-sm tabular-nums text-slate-400">—</span>;
  return (
    <div className="min-w-[110px] space-y-1.5">
      <span className={`text-sm tabular-nums ${colorConsecucion(valor)}`}>{valor} %</span>
      <ProgressBar value={valor} tone={valor >= 100 ? "success" : "danger"} />
    </div>
  );
}

export function ObjetivosVenta({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  const { toast } = useToast();
  const [mes, setMes] = useState(mesActual());
  const [ambito, setAmbito] = useState<Ambito>("comercial");
  const [articuloId, setArticuloId] = useState<string>("");
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams({ mes, ambito });
      if (articuloId) params.set("articuloId", articuloId);
      const res = await fetch(`/api/objetivos-venta?${params}`);
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
      setCargando(false);
    }
  }, [mes, ambito, articuloId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Guarda (o borra, con 0) el objetivo de una fila. */
  const guardar = async (fila: Fila, valor: string) => {
    const limpio = valor.trim();
    const cantidad = limpio === "" ? 0 : Number.parseInt(limpio, 10);
    if (!Number.isInteger(cantidad) || cantidad < 0) {
      toast({ title: "Objetivo no válido", description: "Escribe un número entero de unidades.", variant: "destructive" });
      return;
    }
    setGuardando(fila.sujetoId);
    try {
      const res = await fetch("/api/objetivos-venta", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, ambito, sujetoId: fila.sujetoId, articuloId: articuloId || null, cantidad }),
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
      await cargar();
    } catch {
      toast({ title: "Sin conexión", description: "No se ha guardado el objetivo.", variant: "destructive" });
    } finally {
      setGuardando(null);
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
    await cargar();
  };

  const soloLectura = datos?.soloLectura ?? true;
  const articuloElegido = useMemo(
    () => datos?.articulos.find((a) => a.id === articuloId) ?? null,
    [datos, articuloId],
  );
  const resumen = datos?.resumen;
  const consecucionGlobal =
    resumen && resumen.objetivo > 0
      ? Math.round((resumen.vendido / resumen.objetivo) * 1000) / 10
      : null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{titulo}</h1>
        <p className="text-slate-500 text-sm mt-1 max-w-2xl">{descripcion}</p>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <Label htmlFor="objetivos-mes">Mes</Label>
              <Input
                id="objetivos-mes"
                type="month"
                className="mt-1 w-44"
                value={mes}
                onChange={(e) => setMes(e.target.value || mesActual())}
              />
            </div>
            <div>
              <Label htmlFor="objetivos-ambito">Objetivo de</Label>
              <select
                id="objetivos-ambito"
                className="mt-1 w-48 rounded-md border border-slate-200 px-3 py-2 text-sm"
                value={ambito}
                onChange={(e) => setAmbito(e.target.value as Ambito)}
              >
                <option value="comercial">Cada comercial</option>
                <option value="sede">Cada punto de venta</option>
              </select>
            </div>
            <div>
              <Label htmlFor="objetivos-articulo">Sobre</Label>
              <select
                id="objetivos-articulo"
                className="mt-1 w-64 rounded-md border border-slate-200 px-3 py-2 text-sm"
                value={articuloId}
                onChange={(e) => setArticuloId(e.target.value)}
              >
                <option value="">Unidades totales</option>
                {(datos?.articulos ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                    {a.categoria ? ` · ${a.categoria}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            {articuloElegido
              ? `Objetivo de unidades de "${articuloElegido.nombre}" en el mes elegido.`
              : "Objetivo de unidades vendidas en total, sumando todo el catálogo."}
            {ambito === "sede" &&
              " El objetivo de una sede se compara con lo que vende la sede completa, no con la suma de los de su equipo."}
          </p>
          {/* Sin catálogo, "Sobre" solo ofrece unidades totales: hay que decir
              dónde se definen los productos, o el objetivo por producto parece
              que no existe. */}
          {!soloLectura && (datos?.articulos.length ?? 0) === 0 && (
            <p className="text-xs text-amber-700 mt-2">
              Todavía no tienes productos en el catálogo, así que solo puedes fijar objetivos de
              unidades totales. Añádelos en{" "}
              <a href="/admin/configuracion?tab=catalogo" className="underline font-medium">
                Configuración → Catálogo de ventas
              </a>{" "}
              (pospago, fibra, renove…) y podrás fijar un objetivo por producto.
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
          { label: "Objetivo del mes", valor: String(resumen?.objetivo ?? 0), color: "text-slate-900", barra: null },
          { label: "Vendido", valor: String(resumen?.vendido ?? 0), color: "text-slate-900", barra: null },
          {
            label: "Consecución",
            valor: consecucionGlobal === null ? "—" : `${consecucionGlobal} %`,
            color: colorConsecucion(consecucionGlobal),
            barra: consecucionGlobal,
          },
          {
            label: ambito === "sede" ? "Sedes con objetivo" : "Comerciales con objetivo",
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
                  tone={k.barra >= 100 ? "success" : "danger"}
                  size="md"
                  className="mt-2"
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {cargando ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : datos?.sinSede ? (
            <p className="text-center py-10 text-slate-500 text-sm max-w-md mx-auto">
              No tienes ninguna sede asignada, así que no hay objetivos que consultar. Pídele a
              administración que te asigne tu punto de venta.
            </p>
          ) : (datos?.filas.length ?? 0) === 0 ? (
            <p className="text-center py-10 text-slate-400 text-sm">
              {ambito === "sede"
                ? "No hay puntos de venta activos."
                : "No hay empleados activos a los que fijar objetivo."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {[
                      ambito === "sede" ? "Punto de venta" : "Comercial",
                      ...(ambito === "comercial" ? ["Sede"] : []),
                      "Objetivo",
                      "Vendido",
                      ...(datos?.preciosActivos && articuloElegido?.precio != null ? ["Importe"] : []),
                      "Consecución",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos?.filas.map((f) => (
                    <tr key={f.sujetoId} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2.5 text-sm font-medium text-slate-800">{f.sujeto}</td>
                      {ambito === "comercial" && (
                        <td className="px-4 py-2.5 text-sm text-slate-500">{f.sede ?? "—"}</td>
                      )}
                      <td className="px-4 py-2.5">
                        {soloLectura ? (
                          <span className="text-sm tabular-nums">{f.objetivo ?? "—"}</span>
                        ) : (
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            className="w-24 text-right tabular-nums"
                            defaultValue={f.objetivo ?? ""}
                            placeholder="—"
                            disabled={guardando === f.sujetoId}
                            aria-label={`Objetivo de ${f.sujeto}`}
                            onBlur={(e) => {
                              const nuevo = e.target.value.trim();
                              const actual = f.objetivo === null ? "" : String(f.objetivo);
                              if (nuevo !== actual) void guardar(f, nuevo);
                            }}
                          />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sm tabular-nums">{f.vendido}</td>
                      {datos?.preciosActivos && articuloElegido?.precio != null && (
                        <td className="px-4 py-2.5 text-sm tabular-nums text-slate-600">
                          {f.importe === null ? "—" : eur(f.importe)}
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <Consecucion valor={f.consecucion} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {!soloLectura && (
        <p className="text-xs text-slate-400">
          Cada objetivo se guarda al salir de la casilla. Déjala vacía o escribe 0 para quitarlo.
        </p>
      )}

      {/* Todos los objetivos del mes, sin importar el artículo: es la vista para
          repasar lo fijado sin ir cambiando el selector. */}
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
                    {["Ámbito", "Comercial o sede", "Artículo", "Objetivo", "Vendido", "Consecución", ""].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-2.5"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {datos?.objetivosDelMes.map((o) => (
                    <tr key={o.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 text-sm text-slate-500">
                        {o.ambito === "sede" ? "Sede" : "Comercial"}
                      </td>
                      <td className="px-4 py-2 text-sm font-medium text-slate-800">{o.sujeto}</td>
                      <td className="px-4 py-2 text-sm text-slate-500">
                        {o.articulo ?? "Unidades totales"}
                      </td>
                      <td className="px-4 py-2 text-sm tabular-nums">{o.objetivo}</td>
                      <td className="px-4 py-2 text-sm tabular-nums">{o.vendido}</td>
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
