"use client";

/**
 * Asistente diario de cierre de turno (4 pasos). Entrega 1: la navegación y la
 * tabla de ventas leen ya el catálogo real; el guardado del borrador, los
 * adjuntos, la comparación con objetivos y el aviso de incidencia llegan en la
 * entrega 2 y se avisa en pantalla para no prometer lo que aún no hace.
 *
 * El asistente NO condiciona el fichaje: se puede fichar la salida sin haber
 * cerrado (RD 8/2019, misma regla que el geofencing y el checklist de fichaje).
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASOS_CIERRE, type PasoCierre } from "@/lib/cierre-turno/core";

interface Articulo {
  id: string;
  nombre: string;
  categoria: string | null;
}

const TITULOS: Record<PasoCierre, string> = {
  ventas: "Ventas del día",
  resultados: "Cómo vas",
  caja: "Cierre de caja",
  incidencias: "Incidencias",
};

export function AsistenteCierre() {
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

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch("/api/articulos-venta");
        if (!res.ok) return;
        const data = (await res.json()) as { articulos: Articulo[]; catalogoVacio: boolean };
        if (cancelado) return;
        setArticulos(data.articulos ?? []);
        setCatalogoVacio(Boolean(data.catalogoVacio));
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const indice = PASOS_CIERRE.indexOf(paso);
  const totalUnidades = useMemo(
    () => Object.values(cantidades).reduce((n, v) => n + (parseInt(v, 10) || 0), 0),
    [cantidades],
  );

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Cierre de turno</h1>
        <p className="text-slate-500 text-sm mt-1">
          Registra tus ventas del día, cierra la caja y avisa de cualquier incidencia.
        </p>
      </div>

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

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Estructura del módulo recién montada: por ahora lo que escribas aquí no se guarda.
          El guardado, los adjuntos y los avisos entran en la siguiente entrega.
        </span>
      </div>

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
                    {articulos.map((a) => (
                      <tr key={a.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-2 text-sm text-slate-800">
                          {a.nombre}
                          {a.categoria && (
                            <span className="text-slate-400 text-xs ml-2">{a.categoria}</span>
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
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["", "Este mes", "Objetivo", "Consecución"].map((h) => (
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
                  {["Tú", "Tu sede"].map((quien) => (
                    <tr key={quien} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 text-sm font-medium text-slate-800">{quien}</td>
                      <td className="px-3 py-2 text-sm tabular-nums text-slate-400">—</td>
                      <td className="px-3 py-2 text-sm tabular-nums text-slate-400">—</td>
                      <td className="px-3 py-2 text-sm tabular-nums text-slate-400">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-3">
              Se rellenará cuando existan objetivos del mes y ventas registradas.
            </p>
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
                />
              </div>
            </div>
            <p className="text-sm text-slate-500">
              Aquí se adjuntarán el Excel del stock de la tienda y los comprobantes del TPV.
              Una vez confirmado, el cierre de caja no se puede modificar: solo un
              administrador, y queda registrado quién lo cambió y por qué.
            </p>
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
        <Button
          disabled={indice === PASOS_CIERRE.length - 1}
          onClick={() => setPaso(PASOS_CIERRE[Math.min(PASOS_CIERRE.length - 1, indice + 1)])}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}
