"use client";

/**
 * Cuadre día a día de una tienda contra una fuente externa: el extracto del
 * banco (tickets 1e73c9a4) o el sistema de facturación (4b8e1d05).
 *
 * Es la misma pantalla porque es el mismo problema —lo que la tienda declara
 * frente a lo que dice un tercero, alineado por fecha—; solo cambian las
 * etiquetas y el desfase por defecto. Cada fila lleva las DOS fechas, para que
 * se vea de dónde sale cada cifra.
 *
 * Debajo, el fichero en crudo: cuando una fila no cuadra, hay que poder mirar
 * los apuntes de ese día uno a uno.
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

export interface TextosCuadre {
  /** "Tarjeta" | "Facturación". */
  titulo: string;
  descripcion: string;
  /** De dónde vienen los datos de la derecha: "el banco", "facturación". */
  fuente: string;
  etiquetaDeclarado: string;
  etiquetaFuente: string;
  columnaFechaFuente: string;
  sinDatos: string;
  tituloFichero: string;
}

export function CuadreExterno({
  tiendaId,
  desdeInicial,
  hastaInicial,
  endpoint,
  desfaseInicial,
  textos,
}: {
  tiendaId: string;
  desdeInicial: string;
  hastaInicial: string;
  /** "tarjeta" | "facturacion". */
  endpoint: string;
  desfaseInicial: number;
  textos: TextosCuadre;
}) {
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hastaInicial);
  const [desfase, setDesfase] = useState(desfaseInicial);
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
      const res = await fetch(`/api/conciliacion/${endpoint}?${params}`);
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
  }, [tiendaId, desde, hasta, desfase, endpoint]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href="/admin/conciliacion"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-dark)] inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" />
          Conciliación
        </Link>
        <h1 className="text-2xl font-bold text-[var(--text-dark)] mt-1 flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-[var(--primary)]" />
          {textos.titulo} · {datos?.tienda.nombre ?? "…"}
        </h1>
        <p className="text-[var(--text-muted)] text-sm mt-1 max-w-2xl">{textos.descripcion}</p>
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
              <Label htmlFor="desfase">{textos.fuente} registra</Label>
              <select
                id="desfase"
                className="mt-1 block rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                value={desfase}
                onChange={(e) => setDesfase(Number(e.target.value))}
              >
                <option value={0}>el mismo día</option>
                <option value={1}>al día siguiente</option>
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
        <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5 text-sm text-[var(--text-body)] flex items-start gap-2">
          <HelpCircle className="h-4 w-4 mt-0.5 shrink-0 text-[var(--text-muted)]" />
          <span>{textos.sinDatos}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: textos.etiquetaDeclarado, valor: datos?.totales.declarado, color: "text-[var(--text-dark)]" },
          { label: textos.etiquetaFuente, valor: datos?.totales.banco, color: "text-[var(--primary)]" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-[var(--text-muted)]">{k.label}</p>
              <p className={`text-xl font-bold mt-1 tabular-nums ${k.color}`}>
                {k.valor === undefined ? "—" : eur(k.valor)}
              </p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-[var(--text-muted)]">Días que no cuadran</p>
            <p
              className={`text-xl font-bold mt-1 tabular-nums ${
                (datos?.totales.descuadres ?? 0) > 0 ? "text-[var(--warning-text)]" : "text-[var(--success-text)]"
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
                <div key={i} className="h-10 bg-[var(--muted)] rounded animate-pulse" />
              ))}
            </div>
          ) : (datos?.filas.length ?? 0) === 0 ? (
            <p className="text-center py-8 text-[var(--text-muted)] text-sm">
              No hay nada que cuadrar en estas fechas.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-6">
              <table className="w-full">
                <thead className="bg-[var(--muted)] border-y border-[var(--border)]">
                  <tr>
                    {[
                      "Día de venta",
                      textos.columnaFechaFuente,
                      "Declarado",
                      textos.titulo,
                      "Diferencia",
                      "",
                    ].map((h, i) => (
                      <th
                        key={h || i}
                        className={`text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-4 py-2.5 ${
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
                    <tr key={f.fecha} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2 text-sm text-[var(--text-dark)] whitespace-nowrap">
                        {fechaCorta(f.fecha)}
                      </td>
                      <td className="px-4 py-2 text-sm text-[var(--text-muted)] whitespace-nowrap">
                        {fechaCorta(f.fechaBanco)}
                        {f.movimientos > 1 && (
                          <span className="text-[var(--text-muted)]"> · {f.movimientos} apuntes</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm text-right tabular-nums">
                        {eur(f.declarado)}
                      </td>
                      <td className="px-4 py-2 text-sm text-right tabular-nums">{eur(f.banco)}</td>
                      <td
                        className={`px-4 py-2 text-sm text-right tabular-nums font-semibold ${
                          f.descuadre ? "text-[var(--warning-text)]" : "text-[var(--text-muted)]"
                        }`}
                      >
                        {f.diferencia === 0 ? "—" : eur(f.diferencia)}
                      </td>
                      <td className="px-4 py-2">
                        {f.descuadre ? (
                          <AlertTriangle className="h-4 w-4 text-[var(--warning-text)]" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-[var(--success-text)]" />
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
            <p className="text-sm font-semibold text-[var(--text-dark)]">{textos.tituloFichero}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 mb-3">
              El fichero tal cual se importó, para mirar un día concreto apunte a apunte.
            </p>
            <div className="overflow-x-auto -mx-6">
              <table className="w-full">
                <thead className="bg-[var(--muted)] border-y border-[var(--border)]">
                  <tr>
                    {["Fecha", "Concepto", "Referencia", "Importe"].map((h, i) => (
                      <th
                        key={h}
                        className={`text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-4 py-2.5 ${
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
                    <tr key={m.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2 text-sm text-[var(--text-body)] whitespace-nowrap">
                        {fechaCorta(m.fecha)}
                      </td>
                      <td className="px-4 py-2 text-sm text-[var(--text-dark)]">{m.concepto ?? "—"}</td>
                      <td className="px-4 py-2 text-xs text-[var(--text-muted)] break-all">
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
