"use client";

/**
 * El libro de caja de una tienda (ticket 1e73c9a4).
 *
 * Lo que entra —el efectivo de cada cierre diario, con quién lo cerró— y lo que
 * sale —cada retirada, con la fecha y el responsable que la firmó—, en orden y
 * con el saldo después de cada movimiento. Es la respuesta a "esta tienda no
 * cuadra": aquí se ve el día exacto en el que se torció.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Movimiento {
  fecha: string;
  tipo: "saldo" | "entrada" | "salida";
  concepto: string;
  quien: string | null;
  importe: number;
  saldo: number;
}

interface Respuesta {
  tienda: { id: string; nombre: string };
  desde: string;
  hasta: string;
  sinCaja: boolean;
  movimientos: Movimiento[];
  totales: { entradas: number; salidas: number; saldoFinal: number };
}

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return iso;
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(a, m - 1, d)));
}

export function LibroCaja({
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
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tiendaId, desde, hasta });
      const res = await fetch(`/api/conciliacion/efectivo?${params}`);
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
  }, [tiendaId, desde, hasta]);

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
          <Wallet className="h-6 w-6 text-[var(--primary)]" />
          Efectivo · {datos?.tienda.nombre ?? "…"}
        </h1>
        <p className="text-[var(--text-muted)] text-sm mt-1 max-w-2xl">
          Lo que ha entrado en la caja con cada cierre y lo que se ha retirado, con quién y
          cuándo. El saldo es lo que debería quedar en el cajón después de cada movimiento.
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
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      {datos?.sinCaja && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Esta sede no maneja efectivo nuestro, así que su caja no se arquea.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Ha entrado", valor: datos?.totales.entradas, color: "text-[var(--success-text)]" },
          { label: "Se ha retirado", valor: datos?.totales.salidas, color: "text-[var(--text-dark)]" },
          { label: "Saldo al final", valor: datos?.totales.saldoFinal, color: "text-[var(--primary)]" },
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
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          {cargando ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-[var(--muted)] rounded animate-pulse" />
              ))}
            </div>
          ) : (datos?.movimientos.length ?? 0) === 0 ? (
            <p className="text-center py-8 text-[var(--text-muted)] text-sm">
              No hay movimientos de caja en estas fechas.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-6">
              <table className="w-full">
                <thead className="bg-[var(--muted)] border-y border-[var(--border)]">
                  <tr>
                    {["Fecha", "Concepto", "Quién", "Entra", "Sale", "Saldo"].map((h, i) => (
                      <th
                        key={h}
                        className={`text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-4 py-2.5 ${
                          i >= 3 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos?.movimientos.map((m, i) => (
                    <tr key={`${m.fecha}-${i}`} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2 text-sm text-[var(--text-body)] whitespace-nowrap">
                        {fechaLarga(m.fecha)}
                      </td>
                      <td className="px-4 py-2 text-sm text-[var(--text-dark)]">
                        <span className="flex items-center gap-1.5">
                          {m.tipo === "entrada" ? (
                            <ArrowUpRight className="h-3.5 w-3.5 text-[var(--success-text)] shrink-0" />
                          ) : m.tipo === "salida" ? (
                            <ArrowDownRight className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                          ) : (
                            <Wallet className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                          )}
                          {m.concepto}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-[var(--text-muted)]">{m.quien ?? "—"}</td>
                      <td className="px-4 py-2 text-sm text-right tabular-nums text-[var(--success-text)]">
                        {m.tipo === "entrada" ? eur(m.importe) : ""}
                      </td>
                      <td className="px-4 py-2 text-sm text-right tabular-nums text-rose-700">
                        {m.tipo === "salida" ? eur(m.importe) : ""}
                      </td>
                      <td className="px-4 py-2 text-sm text-right tabular-nums font-semibold text-[var(--text-dark)]">
                        {eur(m.saldo)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
