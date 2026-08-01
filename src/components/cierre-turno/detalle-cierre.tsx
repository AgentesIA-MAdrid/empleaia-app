"use client";

/**
 * Detalle de un cierre de turno, para administración y coordinación.
 *
 * Es la pantalla del "esto no cuadra": qué declaró la persona, sus archivos
 * (Excel del stock, comprobante del datáfono) y, para un administrador, la
 * corrección de la caja con motivo obligatorio.
 *
 * La corrección enseña siempre el rastro de las anteriores. Sin verlo, corregir
 * a ciegas un cierre que ya se tocó dos veces es cómo se pierde la pista de un
 * descuadre.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, History, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface Detalle {
  id: string;
  fecha: string;
  estado: string;
  detalleJornada: string | null;
  incidencia: string | null;
  completado: boolean;
  empleado: { id: string; nombre: string; email: string };
  sede: { id: string; nombre: string } | null;
  preciosActivos: boolean;
  ventas: { id: string; nombre: string; cantidad: number; precio: number | null; importe: number | null }[];
  unidades: number;
  importeVendido: number | null;
  caja: {
    id: string;
    efectivo: number;
    tarjeta: number;
    confirmado: boolean;
    confirmadoEn: string | null;
    adjuntos: { id: string; tipo: string; nombre: string; mime: string; tamañoBytes: number; subidoEn: string }[];
    ediciones: {
      id: string;
      campo: string;
      valorAntes: number;
      valorDespues: number;
      motivo: string;
      cuando: string;
      admin: string;
    }[];
  } | null;
  puedeCorregir: boolean;
}

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const fechaLarga = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" }).format(
    new Date(`${iso}T12:00:00Z`),
  );

const cuando = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(
    new Date(iso),
  );

export function DetalleCierre({
  cierreId,
  onClose,
  onCorregido,
}: {
  cierreId: string | null;
  onClose: () => void;
  /** Para que el listado que lo abrió recargue sus totales tras una corrección. */
  onCorregido?: () => void;
}) {
  const { toast } = useToast();
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [efectivo, setEfectivo] = useState("");
  const [tarjeta, setTarjeta] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    if (!cierreId) return;
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/cierre-turno/detalle?id=${encodeURIComponent(cierreId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "No se ha podido cargar el cierre.");
        setDetalle(null);
        return;
      }
      const d = data as Detalle;
      setDetalle(d);
      setEfectivo(d.caja ? String(d.caja.efectivo) : "");
      setTarjeta(d.caja ? String(d.caja.tarjeta) : "");
      setMotivo("");
      setCorrigiendo(false);
    } catch {
      setError("Sin conexión con el servidor.");
    } finally {
      setCargando(false);
    }
  }, [cierreId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const corregir = async () => {
    if (!detalle?.caja) return;
    setGuardando(true);
    try {
      const res = await fetch("/api/cierre-turno/caja", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cajaId: detalle.caja.id, efectivo, tarjeta, motivo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se pudo corregir",
          description: (data as { error?: string }).error ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Cierre corregido",
        description: "Queda registrado quién lo ha cambiado, qué había antes y por qué.",
      });
      await cargar();
      onCorregido?.();
    } catch {
      toast({ title: "Sin conexión", description: "No se ha guardado la corrección.", variant: "destructive" });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={cierreId !== null} onOpenChange={(abierto) => !abierto && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {detalle ? `Cierre de ${detalle.empleado.nombre}` : "Cierre de turno"}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-6 overflow-y-auto space-y-5">
          {cargando ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-rose-700">{error}</p>
          ) : !detalle ? null : (
            <>
              <div className="text-sm text-slate-500">
                {fechaLarga(detalle.fecha)} · {detalle.sede?.nombre ?? "Sin sede"} ·{" "}
                {detalle.completado ? "Cerrado" : "Sin terminar"}
              </div>

              {detalle.incidencia && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    <strong className="block">Incidencia declarada</strong>
                    {detalle.incidencia}
                  </span>
                </div>
              )}

              {/* Ventas */}
              <div>
                <p className="text-sm font-semibold text-slate-800 mb-2">Ventas declaradas</p>
                {detalle.ventas.length === 0 ? (
                  <p className="text-sm text-slate-400">No registró ninguna venta.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          {["Artículo", "Unidades", ...(detalle.preciosActivos ? ["Importe"] : [])].map((h) => (
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
                        {detalle.ventas.map((v) => (
                          <tr key={v.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-2 text-sm text-slate-800">{v.nombre}</td>
                            <td className="px-3 py-2 text-sm tabular-nums">{v.cantidad}</td>
                            {detalle.preciosActivos && (
                              <td className="px-3 py-2 text-sm tabular-nums text-slate-600">
                                {v.importe === null ? "Sin precio" : eur(v.importe)}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50">
                          <td className="px-3 py-2 text-sm font-semibold text-slate-700">Total</td>
                          <td className="px-3 py-2 text-sm font-bold tabular-nums">{detalle.unidades}</td>
                          {detalle.preciosActivos && (
                            <td className="px-3 py-2 text-sm font-bold tabular-nums">
                              {detalle.importeVendido === null ? "—" : eur(detalle.importeVendido)}
                            </td>
                          )}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {detalle.detalleJornada && (
                <div>
                  <p className="text-sm font-semibold text-slate-800 mb-1">Detalle de la jornada</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{detalle.detalleJornada}</p>
                </div>
              )}

              {/* Caja */}
              <div>
                <p className="text-sm font-semibold text-slate-800 mb-2">Cierre de caja</p>
                {!detalle.caja ? (
                  <p className="text-sm text-slate-400">No llegó a cerrar la caja.</p>
                ) : (
                  <>
                    <div className="grid sm:grid-cols-3 gap-3 text-sm">
                      <div className="rounded-md border border-slate-200 px-3 py-2">
                        <p className="text-slate-500">Efectivo</p>
                        <p className="font-semibold tabular-nums">{eur(detalle.caja.efectivo)}</p>
                      </div>
                      <div className="rounded-md border border-slate-200 px-3 py-2">
                        <p className="text-slate-500">Tarjeta</p>
                        <p className="font-semibold tabular-nums">{eur(detalle.caja.tarjeta)}</p>
                      </div>
                      <div className="rounded-md border border-slate-200 px-3 py-2">
                        <p className="text-slate-500">Total</p>
                        <p className="font-semibold tabular-nums">
                          {eur(detalle.caja.efectivo + detalle.caja.tarjeta)}
                        </p>
                      </div>
                    </div>
                    {detalle.preciosActivos && detalle.importeVendido !== null && (
                      <p className="text-xs text-slate-500 mt-2">
                        Vendido {eur(detalle.importeVendido)} · en caja{" "}
                        {eur(detalle.caja.efectivo + detalle.caja.tarjeta)} · diferencia{" "}
                        <strong
                          className={
                            Math.abs(detalle.importeVendido - (detalle.caja.efectivo + detalle.caja.tarjeta)) >= 1
                              ? "text-amber-700"
                              : "text-slate-600"
                          }
                        >
                          {eur(
                            Math.round(
                              (detalle.importeVendido - (detalle.caja.efectivo + detalle.caja.tarjeta)) * 100,
                            ) / 100,
                          )}
                        </strong>
                      </p>
                    )}

                    {/* Adjuntos */}
                    <div className="mt-3">
                      <p className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                        <Paperclip className="h-3.5 w-3.5 text-slate-400" /> Documentación
                      </p>
                      {detalle.caja.adjuntos.length === 0 ? (
                        <p className="text-sm text-slate-400">No adjuntó ningún archivo.</p>
                      ) : (
                        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                          {detalle.caja.adjuntos.map((a) => (
                            <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                              <span className="min-w-0">
                                <span className="text-slate-400 text-xs uppercase tracking-wide mr-2">
                                  {a.tipo === "stock" ? "Stock" : a.tipo === "gasto" ? "Gasto" : "TPV"}
                                </span>
                                <span className="text-slate-800 break-all">{a.nombre}</span>
                                <span className="text-slate-400 text-xs ml-2 tabular-nums">
                                  {kb(a.tamañoBytes)}
                                </span>
                              </span>
                              {/* Descarga directa: el endpoint sirve el fichero
                                  como attachment, nunca inline. */}
                              <a
                                href={`/api/cierre-turno/adjuntos/${encodeURIComponent(a.id)}`}
                                className="shrink-0"
                                download
                              >
                                <Button variant="ghost" size="sm">
                                  <Download className="h-3.5 w-3.5 mr-1.5" /> Descargar
                                </Button>
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Rastro de correcciones */}
                    {detalle.caja.ediciones.length > 0 && (
                      <div className="mt-3">
                        <p className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                          <History className="h-3.5 w-3.5 text-slate-400" /> Correcciones
                        </p>
                        <ul className="space-y-1.5">
                          {detalle.caja.ediciones.map((e) => (
                            <li key={e.id} className="text-sm text-slate-600">
                              <span className="tabular-nums">
                                {e.campo === "efectivo" ? "Efectivo" : "Tarjeta"}: {eur(e.valorAntes)} →{" "}
                                {eur(e.valorDespues)}
                              </span>
                              <span className="text-slate-400">
                                {" "}
                                · {e.admin}, {cuando(e.cuando)}
                              </span>
                              <span className="block text-slate-500">«{e.motivo}»</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Corrección */}
                    {detalle.puedeCorregir && (
                      <div className="mt-4">
                        {!corrigiendo ? (
                          <Button variant="outline" size="sm" onClick={() => setCorrigiendo(true)}>
                            Corregir importes
                          </Button>
                        ) : (
                          <div className="rounded-md border border-slate-200 p-3 space-y-3">
                            <div className="grid sm:grid-cols-2 gap-3">
                              <div>
                                <Label htmlFor="corr-efectivo">Efectivo</Label>
                                <Input
                                  id="corr-efectivo"
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="mt-1 tabular-nums"
                                  value={efectivo}
                                  onChange={(e) => setEfectivo(e.target.value)}
                                />
                              </div>
                              <div>
                                <Label htmlFor="corr-tarjeta">Tarjeta</Label>
                                <Input
                                  id="corr-tarjeta"
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="mt-1 tabular-nums"
                                  value={tarjeta}
                                  onChange={(e) => setTarjeta(e.target.value)}
                                />
                              </div>
                            </div>
                            <div>
                              <Label htmlFor="corr-motivo">Motivo de la corrección</Label>
                              <textarea
                                id="corr-motivo"
                                rows={2}
                                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                                value={motivo}
                                onChange={(e) => setMotivo(e.target.value)}
                                placeholder="Por qué cambias los importes (queda registrado)."
                              />
                            </div>
                            <div className="flex gap-2 justify-end">
                              <Button variant="ghost" size="sm" onClick={() => setCorrigiendo(false)}>
                                Cancelar
                              </Button>
                              <Button size="sm" disabled={guardando} onClick={() => void corregir()}>
                                {guardando ? "Guardando…" : "Guardar corrección"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
