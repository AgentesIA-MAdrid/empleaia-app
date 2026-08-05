"use client";

/**
 * Seguimiento de objetivos — la segunda subárea de "Objetivos de venta".
 *
 * La definición dice qué se pide este mes; aquí se mira cómo va, día a día, con
 * los filtros puestos: punto de venta, comercial, qué se sigue (unidades
 * totales, un grupo de productos o un producto) y hasta qué día se cuenta.
 *
 * La tabla es la del Excel con el que se lleva esto a mano: objetivo del mes,
 * lo que tocaría llevar a día de hoy, lo vendido, la desviación entre ambos, la
 * consecución, la media diaria, las unidades por día que quedan para llegar y
 * la previsión de cierre. Cuatro vistas de lo mismo: todos los objetivos de una
 * vez, por comercial, por punto de venta y el día a día del mes.
 *
 * "Todos los objetivos" es la que evita ir pulsando concepto por concepto en el
 * desplegable cuando lo que se quiere es la foto entera de una tienda: una fila
 * por objetivo —unidades totales, cada grupo y cada producto— con las mismas
 * columnas (ticket #0091).
 *
 * Cada vista se descarga en CSV con los filtros puestos y con la fila de
 * totales incluida, que es lo que se pide para pasar el seguimiento al resto
 * del equipo y seguir filtrando en la hoja de cálculo.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProgressBar } from "@/components/ui/progress-bar";
import { descargarCSV } from "@/lib/informes/csv-descarga";

type Vista = "concepto" | "comercial" | "sede" | "dia";

interface FilaSeguimiento {
  sujetoId: string;
  sujeto: string;
  sede: string | null;
  objetivo: number | null;
  objetivoAlDia: number | null;
  vendido: number;
  vendidoDelDia: number;
  desviacion: number | null;
  consecucion: number | null;
  mediaDiaria: number;
  ritmoNecesario: number | null;
  prevision: number | null;
}

interface Totales extends Omit<FilaSeguimiento, "sujetoId" | "sujeto" | "sede"> {
  conObjetivo: number;
  cumplen: number;
}

interface PuntoSerie {
  fecha: string;
  vendido: number;
  acumulado: number;
  objetivoAcumulado: number | null;
  desviacion: number | null;
  consecucion: number | null;
}

interface Concepto {
  id: string;
  tipo: "total" | "grupo" | "articulo";
  etiqueta: string;
}

/** Una fila de la vista "Todos los objetivos": un objetivo, no un sujeto. */
interface FilaConcepto extends Omit<FilaSeguimiento, "sujetoId" | "sujeto" | "sede"> {
  conceptoId: string;
  tipo: Concepto["tipo"];
  etiqueta: string;
}

interface Respuesta {
  mes: string;
  corte: string;
  dias: number;
  transcurridos: number;
  restantes: number;
  concepto: Concepto;
  conceptos: Concepto[];
  sedes: { id: string; nombre: string }[];
  comerciales: { id: string; nombre: string; tiendaId: string | null }[];
  filasComerciales: FilaSeguimiento[];
  filasSedes: FilaSeguimiento[];
  filasConceptos: FilaConcepto[];
  totalesComerciales: Totales | null;
  totalesSedes: Totales | null;
  serie: PuntoSerie[];
  objetivoSerie: number | null;
  /** El servidor no ha podido acotar por sede: esta persona no tiene ninguna. */
  sinSede?: boolean;
}

/** Mismo criterio de color que la parrilla de definición: se cumple o no. */
function colorConsecucion(v: number | null): string {
  if (v === null) return "text-[var(--text-muted)]";
  if (v >= 100) return "text-[var(--success-text)] font-semibold";
  return "text-rose-600";
}

function tonoConsecucion(v: number): "success" | "danger" {
  return v >= 100 ? "success" : "danger";
}

/** La desviación se lee de un vistazo: con signo y en verde o rojo. */
function Desviacion({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-sm text-[var(--text-muted)]">—</span>;
  const color = valor >= 0 ? "text-[var(--success-text)] font-semibold" : "text-rose-600";
  return (
    <span className={`text-sm tabular-nums ${color}`}>
      {valor > 0 ? "+" : ""}
      {valor}
    </span>
  );
}

function Consecucion({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-sm tabular-nums text-[var(--text-muted)]">—</span>;
  return (
    <div className="min-w-[7rem] space-y-1.5">
      <span className={`text-sm tabular-nums ${colorConsecucion(valor)}`}>{valor} %</span>
      <ProgressBar value={valor} tone={tonoConsecucion(valor)} />
    </div>
  );
}

const num = (v: number | null) => (v === null ? "—" : String(v));

/** Cómo se llama cada clase de objetivo en la tabla y en el CSV. */
const TIPO_CONCEPTO: Record<Concepto["tipo"], string> = {
  total: "Total",
  grupo: "Grupo",
  articulo: "Producto",
};

/** "12 jul" — el día del mes, para la tabla del día a día. */
function diaCorto(fecha: string): string {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${fecha}T00:00:00Z`),
  );
}

/** Trozo de nombre de fichero sin acentos ni espacios. */
function slug(texto: string): string {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "todo"
  );
}

export function SeguimientoObjetivos({ mes }: { mes: string }) {
  // "" = el día que decida el servidor (hoy, o el último del mes si ya cerró).
  const [hasta, setHasta] = useState("");
  const [tiendaId, setTiendaId] = useState("");
  const [userId, setUserId] = useState("");
  const [concepto, setConcepto] = useState("");
  // Se abre en "todos los objetivos": es la foto que se quiere al entrar, sin
  // tener que elegir antes qué concepto se mira (ticket #0091).
  const [vista, setVista] = useState<Vista>("concepto");
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Al cambiar de mes el día de corte del mes anterior no vale: se vuelve al
  // automático (hoy o el último día del mes que se mire).
  useEffect(() => {
    setHasta("");
  }, [mes]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams({ mes });
      if (hasta) params.set("hasta", hasta);
      if (tiendaId) params.set("tiendaId", tiendaId);
      if (userId) params.set("userId", userId);
      if (concepto) params.set("concepto", concepto);
      const res = await fetch(`/api/objetivos-venta/seguimiento?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "No se ha podido cargar el seguimiento.");
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
  }, [mes, hasta, tiendaId, userId, concepto]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // El servidor acota lo que se le pide: un día fuera del mes o un producto que
  // ya no está en el catálogo vuelven con otro valor. Los filtros se ponen al
  // día con lo que ha contestado, o la pantalla enseñaría una cosa y estaría
  // contando otra.
  useEffect(() => {
    if (!datos) return;
    if (hasta && hasta !== datos.corte) setHasta(datos.corte);
    if (concepto !== datos.concepto.id) setConcepto(datos.concepto.id);
  }, [datos, hasta, concepto]);

  // Si se elige una sede, el desplegable de comerciales solo enseña a los
  // suyos: un comercial de otra tienda no daría ninguna fila.
  const comerciales = useMemo(
    () =>
      (datos?.comerciales ?? []).filter((c) => !tiendaId || c.tiendaId === tiendaId),
    [datos, tiendaId],
  );
  useEffect(() => {
    if (userId && !comerciales.some((c) => c.id === userId)) setUserId("");
  }, [comerciales, userId]);

  const totales = vista === "sede" ? datos?.totalesSedes : datos?.totalesComerciales;
  const filas = vista === "sede" ? (datos?.filasSedes ?? []) : (datos?.filasComerciales ?? []);
  const filasConceptos = datos?.filasConceptos ?? [];
  // Mirando todos los objetivos, la cabecera es la línea de unidades totales:
  // el resumen del alcance, que es la fila que se lee primero.
  const filaTotalConcepto = filasConceptos.find((f) => f.tipo === "total") ?? null;
  // En el día a día las cifras de cabecera son las de la serie: es lo que se
  // está mirando (el comercial elegido o el conjunto de sedes del alcance).
  const ultimo = datos?.serie[datos.serie.length - 1];
  const cabecera =
    vista === "concepto"
      ? {
          objetivo: filaTotalConcepto?.objetivo ?? null,
          vendido: filaTotalConcepto?.vendido ?? 0,
          consecucion: filaTotalConcepto?.consecucion ?? null,
          desviacion: filaTotalConcepto?.desviacion ?? null,
          prevision: filaTotalConcepto?.prevision ?? null,
        }
      : vista === "dia"
      ? {
          objetivo: datos?.objetivoSerie ?? null,
          vendido: ultimo?.acumulado ?? 0,
          consecucion: ultimo?.consecucion ?? null,
          desviacion: ultimo?.desviacion ?? null,
          prevision:
            datos && datos.transcurridos > 0
              ? Math.round(((ultimo?.acumulado ?? 0) / datos.transcurridos) * datos.dias)
              : null,
        }
      : {
          objetivo: totales?.objetivo ?? null,
          vendido: totales?.vendido ?? 0,
          consecucion: totales?.consecucion ?? null,
          desviacion: totales?.desviacion ?? null,
          prevision: totales?.prevision ?? null,
        };

  const exportar = () => {
    if (!datos) return;
    const sufijo = `${datos.mes}_hasta_${datos.corte}_${slug(datos.concepto.etiqueta)}`;
    // Mirando todos los objetivos el fichero no lleva concepto en el nombre:
    // los lleva todos dentro, que es justo lo que se exporta para filtrar luego
    // en la hoja de cálculo.
    if (vista === "concepto") {
      descargarCSV(
        `seguimiento_todos_los_objetivos_${datos.mes}_hasta_${datos.corte}.csv`,
        [
          "Objetivo seguido",
          "Tipo",
          "Objetivo del mes",
          "Objetivo a día de hoy",
          "Vendido",
          `Vendido el ${datos.corte}`,
          "Desviación",
          "Consecución %",
          "Media diaria",
          "Ritmo necesario",
          "Previsión de cierre",
        ],
        filasConceptos.map((f) => [
          f.etiqueta,
          TIPO_CONCEPTO[f.tipo],
          f.objetivo,
          f.objetivoAlDia,
          f.vendido,
          f.vendidoDelDia,
          f.desviacion,
          f.consecucion,
          f.mediaDiaria,
          f.ritmoNecesario,
          f.prevision,
        ]),
      );
      return;
    }
    if (vista === "dia") {
      descargarCSV(
        `seguimiento_dia_a_dia_${sufijo}.csv`,
        ["Día", "Vendido", "Acumulado", "Objetivo acumulado", "Desviación", "Consecución %"],
        datos.serie.map((p) => [
          p.fecha,
          p.vendido,
          p.acumulado,
          p.objetivoAcumulado,
          p.desviacion,
          p.consecucion,
        ]),
      );
      return;
    }
    const esSede = vista === "sede";
    descargarCSV(
      `seguimiento_por_${esSede ? "sede" : "comercial"}_${sufijo}.csv`,
      [
        esSede ? "Punto de venta" : "Comercial",
        ...(esSede ? [] : ["Sede"]),
        "Objetivo del mes",
        "Objetivo a día de hoy",
        "Vendido",
        `Vendido el ${datos.corte}`,
        "Desviación",
        "Consecución %",
        "Media diaria",
        "Ritmo necesario",
        "Previsión de cierre",
      ],
      [
        ...filas.map((f) => [
          f.sujeto,
          ...(esSede ? [] : [f.sede]),
          f.objetivo,
          f.objetivoAlDia,
          f.vendido,
          f.vendidoDelDia,
          f.desviacion,
          f.consecucion,
          f.mediaDiaria,
          f.ritmoNecesario,
          f.prevision,
        ]),
        // El total va en el fichero: es la cifra que se mira primero al abrirlo
        // y sacarla a mano de la pantalla era un paso de más.
        ...(totales
          ? [
              [
                "TOTAL",
                ...(esSede ? [] : [""]),
                totales.objetivo,
                totales.objetivoAlDia,
                totales.vendido,
                totales.vendidoDelDia,
                totales.desviacion,
                totales.consecucion,
                totales.mediaDiaria,
                totales.ritmoNecesario,
                totales.prevision,
              ],
            ]
          : []),
      ],
    );
  };

  const primerDia = `${mes}-01`;
  const ultimoDia = datos ? `${mes}-${String(datos.dias).padStart(2, "0")}` : undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <Label htmlFor="seg-hasta">Contar hasta el día</Label>
              <Input
                id="seg-hasta"
                type="date"
                className="mt-1 w-40"
                value={hasta || (datos?.corte ?? "")}
                min={primerDia}
                max={ultimoDia}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
            {/* Con una sola sede el selector no aporta nada; el coordinador
                además va atado a las suyas en el servidor. */}
            {(datos?.sedes.length ?? 0) > 1 && (
              <div>
                <Label htmlFor="seg-sede">Punto de venta</Label>
                <select
                  id="seg-sede"
                  className="mt-1 w-48 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                  value={tiendaId}
                  onChange={(e) => setTiendaId(e.target.value)}
                >
                  <option value="">Todas las sedes</option>
                  {datos?.sedes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <Label htmlFor="seg-comercial">Comercial</Label>
              <select
                id="seg-comercial"
                className="mt-1 w-48 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              >
                <option value="">Todos los comerciales</option>
                {comerciales.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
            {/* Mirando todos los objetivos a la vez no hay uno que elegir: el
                desplegable solo aporta cuando la tabla es de un concepto. */}
            <div className={vista === "concepto" ? "hidden" : undefined}>
              <Label htmlFor="seg-concepto">Qué se sigue</Label>
              <select
                id="seg-concepto"
                className="mt-1 w-56 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
              >
                {(datos?.conceptos ?? [{ id: "", tipo: "total" as const, etiqueta: "Unidades totales" }]).map(
                  (c) => (
                    <option key={c.id || "total"} value={c.id}>
                      {c.tipo === "grupo" ? `Grupo: ${c.etiqueta}` : c.etiqueta}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div>
              <Label htmlFor="seg-vista">Ver</Label>
              <select
                id="seg-vista"
                className="mt-1 w-48 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                value={vista}
                onChange={(e) => setVista(e.target.value as Vista)}
              >
                <option value="concepto">Todos los objetivos</option>
                <option value="comercial">Por comercial</option>
                <option value="sede">Por punto de venta</option>
                <option value="dia">Día a día</option>
              </select>
            </div>
            <Button variant="outline" disabled={!datos || cargando} onClick={exportar} className="ml-auto">
              <Download className="h-4 w-4 mr-2" /> Descargar CSV
            </Button>
          </div>
          {datos && (
            <p className="text-xs text-[var(--text-muted)] mt-3 max-w-3xl">
              Van {datos.transcurridos} de {datos.dias} días del mes
              {datos.restantes > 0 ? ` (quedan ${datos.restantes})` : " (mes cerrado)"}, contando
              hasta el {diaCorto(datos.corte)}. <strong className="font-medium text-[var(--text-muted)]">
              Objetivo a día de hoy</strong> es la parte del objetivo del mes que tocaría llevar a
              estas alturas, repartido por días; la desviación es lo vendido menos esa cifra.
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
          { label: "Objetivo del mes", valor: num(cabecera.objetivo), color: "text-[var(--text-dark)]", barra: null },
          {
            label: `Vendido hasta el ${datos ? diaCorto(datos.corte) : "día"}`,
            valor: String(cabecera.vendido),
            color: "text-[var(--text-dark)]",
            barra: null,
          },
          {
            label: "Consecución",
            valor: cabecera.consecucion === null ? "—" : `${cabecera.consecucion} %`,
            color: colorConsecucion(cabecera.consecucion),
            barra: cabecera.consecucion,
          },
          {
            label: "Previsión de cierre",
            valor: num(cabecera.prevision),
            color: "text-[var(--primary)]",
            barra: null,
          },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-[var(--text-muted)]">{k.label}</p>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${k.color}`}>{k.valor}</p>
              {k.barra !== null && (
                <ProgressBar value={k.barra} tone={tonoConsecucion(k.barra)} size="md" className="mt-2" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {vista === "concepto" && datos && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">
          Todos los objetivos de {userId ? "este comercial" : tiendaId ? "esta tienda" : "el conjunto"}{" "}
          con los filtros puestos. Las líneas sin objetivo fijado se quedan con un guion en la
          columna del objetivo, pero siguen enseñando lo vendido.
        </p>
      )}
      {totales && vista !== "dia" && vista !== "concepto" && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">
          {totales.cumplen} de {totales.conObjetivo}{" "}
          {vista === "sede" ? "puntos de venta" : "comerciales"} con objetivo llegan al 100 %. Al
          ritmo de estos días quedan {num(totales.ritmoNecesario)} unidades por día para llegar a
          fin de mes.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {cargando ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 bg-[var(--muted)] rounded animate-pulse" />
              ))}
            </div>
          ) : datos?.sinSede ? (
            <p className="text-center py-10 text-[var(--text-muted)] text-sm max-w-md mx-auto">
              No tienes ninguna sede asignada, así que no hay seguimiento que hacer. Pídele a
              administración que te asigne tu punto de venta.
            </p>
          ) : !datos ? null : vista === "concepto" ? (
            <TablaConceptos corte={datos.corte} filas={filasConceptos} />
          ) : vista === "dia" ? (
            <TablaDias serie={datos.serie} />
          ) : (
            <TablaFilas
              etiquetaSujeto={vista === "sede" ? "Punto de venta" : "Comercial"}
              mostrarSede={vista === "comercial"}
              corte={datos.corte}
              filas={filas}
              totales={totales ?? null}
              vacio={
                vista === "sede"
                  ? "No hay puntos de venta activos."
                  : "No hay comerciales que seguir con estos filtros."
              }
            />
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-[var(--text-muted)] max-w-2xl flex items-start gap-2">
        <TrendingUp className="h-4 w-4 mt-0.5 shrink-0 text-[var(--text-muted)]" />
        <span>
          Lo vendido sale de los cierres de turno de cada día, contando cada venta en la sede donde
          se hizo. Los objetivos se fijan en la subárea <strong>Definición de objetivos</strong>.
        </span>
      </p>
    </div>
  );
}

/** Cabecera de tabla con el estilo del resto del módulo. */
function Cabeceras({ columnas }: { columnas: string[] }) {
  return (
    <thead className="bg-[var(--muted)] border-b border-[var(--border)]">
      <tr>
        {columnas.map((h) => (
          <th
            key={h}
            className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-4 py-3"
          >
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** Seguimiento por comercial o por punto de venta. */
function TablaFilas({
  etiquetaSujeto,
  mostrarSede,
  corte,
  filas,
  totales,
  vacio,
}: {
  etiquetaSujeto: string;
  mostrarSede: boolean;
  corte: string;
  filas: FilaSeguimiento[];
  totales: Totales | null;
  vacio: string;
}) {
  if (filas.length === 0) {
    return <p className="text-center py-10 text-[var(--text-muted)] text-sm">{vacio}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <Cabeceras
          columnas={[
            etiquetaSujeto,
            ...(mostrarSede ? ["Sede"] : []),
            "Objetivo",
            "A día de hoy",
            "Vendido",
            `Día ${diaCorto(corte)}`,
            "Desviación",
            "Consecución",
            "Media/día",
            "Ritmo necesario",
            "Previsión",
          ]}
        />
        <tbody>
          {filas.map((f) => (
            <tr key={f.sujetoId} className="border-b border-[var(--border)] last:border-0">
              <td className="px-4 py-2.5 text-sm font-medium text-[var(--text-dark)]">{f.sujeto}</td>
              {mostrarSede && (
                <td className="px-4 py-2.5 text-sm text-[var(--text-muted)]">{f.sede ?? "Sin sede"}</td>
              )}
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-dark)]">{num(f.objetivo)}</td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-muted)]">{num(f.objetivoAlDia)}</td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-dark)]">{f.vendido}</td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-muted)]">{f.vendidoDelDia}</td>
              <td className="px-4 py-2.5">
                <Desviacion valor={f.desviacion} />
              </td>
              <td className="px-4 py-2.5">
                <Consecucion valor={f.consecucion} />
              </td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-body)]">{f.mediaDiaria}</td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-body)]">
                {num(f.ritmoNecesario)}
              </td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-body)]">{num(f.prevision)}</td>
            </tr>
          ))}
        </tbody>
        {totales && (
          <tfoot className="bg-[var(--muted)] border-t border-[var(--border)]">
            <tr>
              <td
                className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                colSpan={mostrarSede ? 2 : 1}
              >
                Total
              </td>
              <td className="px-4 py-2.5 text-sm font-semibold tabular-nums text-[var(--text-dark)]">
                {num(totales.objetivo)}
              </td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-muted)]">
                {num(totales.objetivoAlDia)}
              </td>
              <td className="px-4 py-2.5 text-sm font-semibold tabular-nums text-[var(--text-dark)]">
                {totales.vendido}
              </td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-muted)]">
                {totales.vendidoDelDia}
              </td>
              <td className="px-4 py-2.5">
                <Desviacion valor={totales.desviacion} />
              </td>
              <td className="px-4 py-2.5">
                <Consecucion valor={totales.consecucion} />
              </td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-body)]">
                {totales.mediaDiaria}
              </td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-body)]">
                {num(totales.ritmoNecesario)}
              </td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-body)]">
                {num(totales.prevision)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * Todos los objetivos del alcance, uno por fila. Es la misma tabla de siempre
 * con la primera columna cambiada: en vez de quién, qué se sigue.
 */
function TablaConceptos({ corte, filas }: { corte: string; filas: FilaConcepto[] }) {
  if (filas.length === 0) {
    return (
      <p className="text-center py-10 text-[var(--text-muted)] text-sm">
        No hay nada que seguir: el catálogo no tiene productos que cuenten para objetivos.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <Cabeceras
          columnas={[
            "Objetivo seguido",
            "Tipo",
            "Objetivo",
            "A día de hoy",
            "Vendido",
            `Día ${diaCorto(corte)}`,
            "Desviación",
            "Consecución",
            "Media/día",
            "Ritmo necesario",
            "Previsión",
          ]}
        />
        <tbody>
          {filas.map((f) => (
            <tr
              key={f.conceptoId || "total"}
              // La línea de unidades totales es el resumen de las demás: se
              // resalta para no confundirla con un grupo más.
              className={`border-b border-[var(--border)] last:border-0 ${
                f.tipo === "total" ? "bg-[var(--muted)]" : ""
              }`}
            >
              <td className="px-4 py-2.5 text-sm font-medium text-[var(--text-dark)]">{f.etiqueta}</td>
              <td className="px-4 py-2.5 text-sm text-[var(--text-muted)]">{TIPO_CONCEPTO[f.tipo]}</td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-dark)]">{num(f.objetivo)}</td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-muted)]">
                {num(f.objetivoAlDia)}
              </td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-dark)]">{f.vendido}</td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-muted)]">{f.vendidoDelDia}</td>
              <td className="px-4 py-2.5">
                <Desviacion valor={f.desviacion} />
              </td>
              <td className="px-4 py-2.5">
                <Consecucion valor={f.consecucion} />
              </td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-body)]">{f.mediaDiaria}</td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-body)]">
                {num(f.ritmoNecesario)}
              </td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-body)]">{num(f.prevision)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** El día a día del mes: lo de cada día y el acumulado frente al objetivo. */
function TablaDias({ serie }: { serie: PuntoSerie[] }) {
  if (serie.length === 0) {
    return (
      <p className="text-center py-10 text-[var(--text-muted)] text-sm">
        Este mes todavía no ha empezado, así que no hay días que seguir.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <Cabeceras
          columnas={["Día", "Vendido", "Acumulado", "Objetivo acumulado", "Desviación", "Consecución"]}
        />
        <tbody>
          {serie.map((p) => (
            <tr key={p.fecha} className="border-b border-[var(--border)] last:border-0">
              <td className="px-4 py-2.5 text-sm font-medium text-[var(--text-dark)]">{diaCorto(p.fecha)}</td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-dark)]">{p.vendido}</td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-dark)]">{p.acumulado}</td>
              <td className="px-4 py-2.5 text-sm tabular-nums text-[var(--text-muted)]">
                {num(p.objetivoAcumulado)}
              </td>
              <td className="px-4 py-2.5">
                <Desviacion valor={p.desviacion} />
              </td>
              <td className="px-4 py-2.5">
                <Consecucion valor={p.consecucion} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
