"use client";

/**
 * Listado de cierres de turno de un día. Lo usan administración (todas las
 * sedes) y coordinación (su sede). El alcance real lo decide el servidor a
 * partir del rol: aquí solo se pinta lo que devuelve.
 */

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DetalleCierre } from "@/components/cierre-turno/detalle-cierre";

interface CierreFila {
  id: string;
  estado: string;
  tieneIncidencia: boolean;
  completado: boolean;
  empleado: string;
  sede: string | null;
  articulosVendidos: number;
  caja: { efectivo: number; tarjeta: number; confirmado: boolean } | null;
}

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

export function PanelCierres({ titulo }: { titulo: string }) {
  const [fecha, setFecha] = useState(format(new Date(), "yyyy-MM-dd"));
  const [filas, setFilas] = useState<CierreFila[]>([]);
  const [cargando, setCargando] = useState(true);
  /** Cierre abierto en el detalle (null = ninguno). */
  const [detalleId, setDetalleId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/cierre-turno?fecha=${fecha}`);
      if (!res.ok) {
        setFilas([]);
        return;
      }
      const data = (await res.json()) as { cierres: CierreFila[] };
      setFilas(Array.isArray(data.cierres) ? data.cierres : []);
    } catch {
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }, [fecha]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const conIncidencia = filas.filter((f) => f.tieneIncidencia).length;
  const sinCerrar = filas.filter((f) => !f.completado).length;
  const efectivo = filas.reduce((n, f) => n + (f.caja?.efectivo ?? 0), 0);
  const tarjeta = filas.reduce((n, f) => n + (f.caja?.tarjeta ?? 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-dark)]">{titulo}</h1>
        <p className="text-[var(--text-muted)] text-sm mt-1">
          Ventas, caja e incidencias que ha registrado tu equipo cada día.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <Label htmlFor="fecha-cierres">Día</Label>
              <Input
                id="fecha-cierres"
                type="date"
                className="mt-1 w-44"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        {[
          { label: "Cierres del día", valor: String(filas.length), color: "text-[var(--text-dark)]" },
          { label: "Sin cerrar", valor: String(sinCerrar), color: sinCerrar ? "text-[var(--warning-text)]" : "text-[var(--text-dark)]" },
          { label: "Con incidencia", valor: String(conIncidencia), color: conIncidencia ? "text-rose-600" : "text-[var(--text-dark)]" },
          { label: "Efectivo + tarjeta", valor: eur(efectivo + tarjeta), color: "text-[var(--primary)]" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-[var(--text-muted)]">{k.label}</p>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${k.color}`}>{k.valor}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {cargando ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-[var(--muted)] rounded animate-pulse" />
              ))}
            </div>
          ) : filas.length === 0 ? (
            <p className="text-center py-10 text-[var(--text-muted)] text-sm">
              Nadie ha registrado cierre este día.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--muted)] border-b border-[var(--border)]">
                  <tr>
                    {["Empleado", "Sede", "Estado", "Artículos", "Efectivo", "Tarjeta", ""].map((h) => (
                      <th
                        key={h}
                        className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-4 py-3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-3 text-sm font-medium text-[var(--text-dark)]">{f.empleado}</td>
                      <td className="px-4 py-3 text-sm text-[var(--text-muted)]">{f.sede ?? "—"}</td>
                      <td className="px-4 py-3 text-sm">
                        {f.tieneIncidencia ? (
                          <span className="inline-flex items-center gap-1.5 text-rose-700">
                            <AlertTriangle className="h-3.5 w-3.5" /> Con incidencia
                          </span>
                        ) : f.completado ? (
                          <span className="inline-flex items-center gap-1.5 text-[var(--success-text)]">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Cerrado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[var(--warning-text)]">
                            <CircleDashed className="h-3.5 w-3.5" /> Sin terminar
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">{f.articulosVendidos}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{f.caja ? eur(f.caja.efectivo) : "—"}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{f.caja ? eur(f.caja.tarjeta) : "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDetalleId(f.id)}>
                          Ver detalle →
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* El detalle trae los archivos y la corrección de la caja; al corregir se
          recarga el listado para que los totales de arriba no queden viejos. */}
      <DetalleCierre cierreId={detalleId} onClose={() => setDetalleId(null)} onCorregido={cargar} />
    </div>
  );
}
