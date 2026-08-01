"use client";

/**
 * El cuadre de tarjeta de una tienda, día a día (ticket 1e73c9a4).
 *
 * Lo que la tienda dice haber cobrado con el datáfono cada día, frente a lo que
 * el banco ingresó **al día siguiente**: las liquidaciones entran con desfase,
 * así que comparar el mismo día marcaría descuadre en todas partes. Cada fila
 * lleva las dos fechas para que se vea de dónde sale cada cifra.
 *
 * Debajo, el extracto en crudo: cuando una fila no cuadra, hay que poder mirar
 * los movimientos de ese día uno a uno.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, CreditCard, HelpCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Fila {
  fecha: string;
  fechaBanco: string;
  declarado: number;
  banco: number;
  diferencia: number;
  descuadre: boolean;
  movimientos: number;
}

interface MovimientoBanco {
  id: string;
  fecha: string;
  importe: number;
  concepto: string | null;
  referencia: string | null;
}

interface Respuesta {
  tienda: { id: string; nombre: string };
  desfase: number;
  umbral: number;
  filas: Fila[];
  movimientos: MovimientoBanco[];
  totales: { declarado: number; banco: number; descuadres: number };
  sinExtracto: boolean;
}

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return iso;
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(a, m - 1, d)))
    .replace(".", "");
}

export function CuadreTarjeta({
  tiendaId,
  desdeInicial,
  hastaInicial,
}: {
  tiendaId: string;
  desdeInicial: string;
  hastaInicial: string;
}) {
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hastaInicial);
  const [desfase, setDesfase] = useState(1);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        tiendaId,
        desde,
        hasta,
        desfase: String(desfase),
      });
      const res = await fetch(`/api/conciliacion/tarjeta?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "No se ha podido cargar.");
        return;
      }
      setDatos(data as Respuesta);
    } catch {
      setError("Sin conexión.");
    } finally {
      setCargando(false);
    }
  }, [tiendaId, desde, hasta, desfase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href="/admin/conciliacion"
          className="text-sm text-slate-500 hover:text-slate-800 inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" />
          Conciliación
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1 flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-[var(--primary)]" />
          Tarjeta · {datos?.tienda.nombre ?? "…"}
        </h1>
        <p className="text-slate-500 text-sm mt-1 max-w-2xl">
          Lo que la tienda declaró haber cobrado con el datáfono cada día, frente a lo que
          entró en el banco. El dinero de un día aparece en el extracto al día siguiente, así
          que cada fila compara las dos fechas.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <Label htmlFor="desde">Desde</Label>
              <Input
                id="desde"
                type="date"
                className="mt-1 w-44"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="hasta">Hasta</Label>
              <Input
                id="hasta"
                type="date"
                className="mt-1 w-44"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="desfase">El banco ingresa</Label>
              <select
                id="desfase"
                className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm"
                value={desfase}
                onChange={(e) => setDesfase(Number(e.target.value))}
              >
                <option value={1}>al día siguiente</option>
                <option value={0}>el mismo día</option>
                <option value={2}>a los 2 días</option>
                <option value={3}>a los 3 días</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      {datos?.sinExtracto && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600 flex items-start gap-2">
          <HelpCircle className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
          <span>
            No hay movimientos del banco de esta tienda en estas fechas. Importa el extracto
            desde la pantalla de Conciliación para poder cuadrar: sin él, todo aparecería como
            si faltara el dinero.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Declarado en cierres", valor: datos?.totales.declarado, color: "text-slate-900" },
          { label: "Ingresado por el banco", valor: datos?.totales.banco, color: "text-[var(--primary)]" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-slate-500">{k.label}</p>
              <p className={`text-xl font-bold mt-1 tabular-nums ${k.color}`}>
                {k.valor === undefined ? "—" : eur(k.valor)}
              </p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-slate-500">Días que no cuadran</p>
            <p
              className={`text-xl font-bold mt-1 tabular-nums ${
                (datos?.totales.descuadres ?? 0) > 0 ? "text-amber-700" : "text-emerald-700"
              }`}
            >
              {datos?.totales.descuadres ?? "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          {cargando ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : (datos?.filas.length ?? 0) === 0 ? (
            <p className="text-center py-8 text-slate-400 text-sm">
              No hay cobros con tarjeta ni ingresos en estas fechas.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-6">
              <table className="w-full">
                <thead className="bg-slate-50 border-y border-slate-200">
                  <tr>
                    {[
                      "Día de venta",
                      "Ingreso del banco",
                      "Declarado",
                      "En el banco",
                      "Diferencia",
                      "",
                    ].map((h, i) => (
                      <th
                        key={h || i}
                        className={`text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-2.5 ${
                          i >= 2 && i <= 4 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos?.filas.map((f) => (
                    <tr key={f.fecha} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 text-sm text-slate-800 whitespace-nowrap">
                        {fechaCorta(f.fecha)}
                      </td>
                      <td className="px-4 py-2 text-sm text-slate-500 whitespace-nowrap">
                        {fechaCorta(f.fechaBanco)}
                        {f.movimientos > 1 && (
                          <span className="text-slate-400"> · {f.movimientos} apuntes</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm text-right tabular-nums">
                        {eur(f.declarado)}
                      </td>
                      <td className="px-4 py-2 text-sm text-right tabular-nums">{eur(f.banco)}</td>
                      <td
                        className={`px-4 py-2 text-sm text-right tabular-nums font-semibold ${
                          f.descuadre ? "text-amber-700" : "text-slate-500"
                        }`}
                      >
                        {f.diferencia === 0 ? "—" : eur(f.diferencia)}
                      </td>
                      <td className="px-4 py-2">
                        {f.descuadre ? (
                          <AlertTriangle className="h-4 w-4 text-amber-600" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
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

      {(datos?.movimientos.length ?? 0) > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm font-semibold text-slate-800">
              Movimientos del banco importados
            </p>
            <p className="text-xs text-slate-500 mt-0.5 mb-3">
              El extracto tal cual se importó, para mirar un día concreto apunte a apunte.
            </p>
            <div className="overflow-x-auto -mx-6">
              <table className="w-full">
                <thead className="bg-slate-50 border-y border-slate-200">
                  <tr>
                    {["Fecha", "Concepto", "Referencia", "Importe"].map((h, i) => (
                      <th
                        key={h}
                        className={`text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-2.5 ${
                          i === 3 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos?.movimientos.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 text-sm text-slate-600 whitespace-nowrap">
                        {fechaCorta(m.fecha)}
                      </td>
                      <td className="px-4 py-2 text-sm text-slate-800">{m.concepto ?? "—"}</td>
                      <td className="px-4 py-2 text-xs text-slate-400 break-all">
                        {m.referencia ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-sm text-right tabular-nums">
                        {eur(m.importe)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
