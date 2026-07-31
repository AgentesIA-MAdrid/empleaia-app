"use client";

/**
 * Informe de ventas — pestaña dentro de Informes.
 *
 * Tres vistas del mismo periodo (por artículo, por comercial, por sede) y, a la
 * cabeza, el cruce que de verdad importa: lo vendido frente a lo que se declaró
 * en caja. Si el cliente no trabaja con precios, se compara en unidades y no se
 * habla de euros de venta.
 *
 * Vive en su propio componente y no dentro de la página de informes porque el
 * módulo es Enterprise: sin la feature, la pestaña no se pinta.
 */

import { useCallback, useEffect, useState } from "react";
import { Download, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { descargarCSV } from "@/lib/informes/csv-descarga";

type Agrupacion = "articulo" | "comercial" | "sede";

interface FilaArticulo {
  articuloId: string | null;
  nombre: string;
  categoria: string | null;
  unidades: number;
  precio: number | null;
  importe: number | null;
}

interface FilaComercial {
  userId: string;
  nombre: string;
  sede: string | null;
  unidades: number;
  importe: number | null;
}

interface FilaSede {
  tiendaId: string | null;
  nombre: string;
  unidades: number;
  importe: number | null;
}

interface Informe {
  desde: string;
  hasta: string;
  preciosActivos: boolean;
  porArticulo: FilaArticulo[];
  porComercial: FilaComercial[];
  porSede: FilaSede[];
  totales: {
    unidades: number;
    importe: number | null;
    unidadesSinPrecio: number;
    cierres: number;
    cajas: number;
    efectivo: number;
    tarjeta: number;
    caja: number;
  };
}

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

/** Primer día del mes en curso, en horario peninsular. */
function inicioDeMes(): string {
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

export function InformeVentas({ sedes = [] }: { sedes?: { id: string; nombre: string }[] }) {
  const [desde, setDesde] = useState(inicioDeMes());
  const [hasta, setHasta] = useState(hoyMadrid());
  const [tiendaId, setTiendaId] = useState<string>("");
  const [agrupacion, setAgrupacion] = useState<Agrupacion>("articulo");
  const [datos, setDatos] = useState<Informe | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams({ desde, hasta });
      if (tiendaId) params.set("tiendaId", tiendaId);
      const res = await fetch(`/api/informes/ventas?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "No se ha podido cargar el informe.");
        setDatos(null);
        return;
      }
      setDatos(data as Informe);
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

  const t = datos?.totales;
  const conPrecios = datos?.preciosActivos ?? false;
  // Diferencia entre lo vendido y lo cobrado. Solo tiene sentido con precios:
  // sin ellos no hay importe de venta con el que comparar la caja.
  const diferencia = conPrecios && t?.importe != null ? Math.round((t.importe - t.caja) * 100) / 100 : null;

  const exportar = () => {
    if (!datos) return;
    const sufijo = `${datos.desde}_${datos.hasta}`;
    if (agrupacion === "articulo") {
      descargarCSV(
        `ventas_por_articulo_${sufijo}.csv`,
        ["Artículo", "Categoría", "Unidades", "Precio", "Importe"],
        datos.porArticulo.map((f) => [f.nombre, f.categoria, f.unidades, f.precio, f.importe]),
      );
    } else if (agrupacion === "comercial") {
      descargarCSV(
        `ventas_por_comercial_${sufijo}.csv`,
        ["Comercial", "Sede", "Unidades", "Importe"],
        datos.porComercial.map((f) => [f.nombre, f.sede, f.unidades, f.importe]),
      );
    } else {
      descargarCSV(
        `ventas_por_sede_${sufijo}.csv`,
        ["Punto de venta", "Unidades", "Importe"],
        datos.porSede.map((f) => [f.nombre, f.unidades, f.importe]),
      );
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <Label htmlFor="ventas-desde">Desde</Label>
              <Input
                id="ventas-desde"
                type="date"
                className="mt-1 w-40"
                value={desde}
                max={hasta}
                onChange={(e) => setDesde(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ventas-hasta">Hasta</Label>
              <Input
                id="ventas-hasta"
                type="date"
                className="mt-1 w-40"
                value={hasta}
                min={desde}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
            {/* Con una sola sede el selector no aporta nada; el coordinador
                además va atado a la suya en el servidor. */}
            {sedes.length > 1 && (
              <div>
                <Label htmlFor="ventas-sede">Punto de venta</Label>
                <select
                  id="ventas-sede"
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
            <div>
              <Label htmlFor="ventas-agrupacion">Agrupar por</Label>
              <select
                id="ventas-agrupacion"
                className="mt-1 w-48 rounded-md border border-slate-200 px-3 py-2 text-sm"
                value={agrupacion}
                onChange={(e) => setAgrupacion(e.target.value as Agrupacion)}
              >
                <option value="articulo">Artículo o servicio</option>
                <option value="comercial">Comercial</option>
                <option value="sede">Punto de venta</option>
              </select>
            </div>
            <Button variant="outline" disabled={!datos || cargando} onClick={exportar} className="ml-auto">
              <Download className="h-4 w-4 mr-2" /> Descargar CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        {[
          { label: "Unidades vendidas", valor: String(t?.unidades ?? 0), color: "text-slate-900" },
          {
            label: "Importe vendido",
            valor: conPrecios && t?.importe != null ? eur(t.importe) : "—",
            color: "text-slate-900",
          },
          { label: "Declarado en caja", valor: t ? eur(t.caja) : "—", color: "text-[var(--primary)]" },
          {
            label: "Cierres del periodo",
            valor: String(t?.cierres ?? 0),
            color: "text-slate-900",
          },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-slate-500">{k.label}</p>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${k.color}`}>{k.valor}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* El cruce venta ↔ caja. Se avisa de lo que no se puede afirmar: sin
          precios en todos los artículos, la diferencia no es un descuadre. */}
      {t && (
        <Card>
          <CardContent className="pt-4 pb-4 text-sm space-y-2">
            <p className="font-semibold text-slate-800 flex items-center gap-2">
              <Scale className="h-4 w-4 text-[var(--primary)]" /> Ventas frente a caja
            </p>
            <p className="text-slate-600">
              Efectivo <strong>{eur(t.efectivo)}</strong> + tarjeta <strong>{eur(t.tarjeta)}</strong> ={" "}
              <strong>{eur(t.caja)}</strong> en {t.cajas} cierre{t.cajas === 1 ? "" : "s"} de caja.
            </p>
            {conPrecios ? (
              diferencia === null ? null : (
                <p className={Math.abs(diferencia) >= 1 ? "text-amber-700" : "text-slate-600"}>
                  Diferencia con el importe vendido: <strong>{eur(diferencia)}</strong>
                  {t.unidadesSinPrecio > 0 && (
                    <>
                      {" "}
                      — ojo: {t.unidadesSinPrecio} unidades son de artículos sin precio, así que el
                      importe vendido está incompleto.
                    </>
                  )}
                </p>
              )
            ) : (
              <p className="text-slate-500">
                Tu catálogo no tiene precios activados, así que aquí solo se cuentan unidades. Puedes
                activarlos en Configuración → Catálogo de ventas para comparar euros con euros.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {cargando ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : !datos || (t?.unidades ?? 0) === 0 ? (
            <p className="text-center py-10 text-slate-400 text-sm">
              No hay ventas registradas en este periodo.
            </p>
          ) : agrupacion === "articulo" ? (
            <TablaSimple
              cabeceras={["Artículo o servicio", "Categoría", "Unidades", ...(conPrecios ? ["Precio", "Importe"] : [])]}
              filas={datos.porArticulo.map((f) => [
                f.nombre,
                f.categoria ?? "—",
                String(f.unidades),
                ...(conPrecios ? [f.precio === null ? "Sin precio" : eur(f.precio), f.importe === null ? "—" : eur(f.importe)] : []),
              ])}
            />
          ) : agrupacion === "comercial" ? (
            <TablaSimple
              cabeceras={["Comercial", "Sede", "Unidades", ...(conPrecios ? ["Importe"] : [])]}
              filas={datos.porComercial.map((f) => [
                f.nombre,
                f.sede ?? "—",
                String(f.unidades),
                ...(conPrecios ? [f.importe === null ? "—" : eur(f.importe)] : []),
              ])}
            />
          ) : (
            <TablaSimple
              cabeceras={["Punto de venta", "Unidades", ...(conPrecios ? ["Importe"] : [])]}
              filas={datos.porSede.map((f) => [
                f.nombre,
                String(f.unidades),
                ...(conPrecios ? [f.importe === null ? "—" : eur(f.importe)] : []),
              ])}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Tabla de solo lectura: la primera columna es el nombre, el resto números. */
function TablaSimple({ cabeceras, filas }: { cabeceras: string[]; filas: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            {cabeceras.map((h) => (
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
          {filas.map((f, i) => (
            <tr key={`${f[0]}-${i}`} className="border-b border-slate-100 last:border-0">
              {f.map((c, j) => (
                <td
                  key={j}
                  className={
                    j === 0
                      ? "px-4 py-2.5 text-sm font-medium text-slate-800"
                      : "px-4 py-2.5 text-sm text-slate-600 tabular-nums"
                  }
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
