"use client";

import { useEffect, useState, useCallback, useMemo, use } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";

type TipoPregunta = "escala_1_5" | "texto" | "opcion";
interface Pregunta { idx: number; texto: string; tipo: TipoPregunta; opciones?: string[]; }
interface Encuesta {
  id: string; titulo: string; descripcion: string | null;
  preguntas: Pregunta[]; anonima: boolean;
  estado: "borrador" | "abierta" | "cerrada"; cierraAt: string | null;
  _count: { respuestas: number };
}
interface RespuestaItem { preguntaIdx: number; valor: number | string }
interface Respuesta { respuestas: RespuestaItem[]; createdAt: string }

export default function EncuestaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [encuesta, setEncuesta] = useState<Encuesta | null>(null);
  const [respuestas, setRespuestas] = useState<Respuesta[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/encuestas/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setEncuesta(data.encuesta);
      setRespuestas(data.respuestas ?? []);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Agregaciones por pregunta — solo se cuentan respuestas no vacías
  // (las del placeholder anti-duplicado tienen `respuestas: []`).
  const stats = useMemo(() => {
    if (!encuesta) return null;
    const reales = respuestas.filter((r) => Array.isArray(r.respuestas) && r.respuestas.length > 0);
    return encuesta.preguntas.map((p) => {
      const items = reales
        .map((r) => r.respuestas.find((x) => x.preguntaIdx === p.idx))
        .filter((x): x is RespuestaItem => !!x);
      if (p.tipo === "escala_1_5") {
        const valores = items.map((i) => Number(i.valor)).filter((n) => !isNaN(n));
        const dist = [0, 0, 0, 0, 0];
        for (const v of valores) if (v >= 1 && v <= 5) dist[v - 1]++;
        const total = valores.length;
        const media = total > 0 ? valores.reduce((a, b) => a + b, 0) / total : 0;
        return { pregunta: p, tipo: "escala" as const, dist, media, total };
      }
      if (p.tipo === "opcion") {
        const counts: Record<string, number> = {};
        for (const i of items) {
          const k = String(i.valor);
          counts[k] = (counts[k] ?? 0) + 1;
        }
        return { pregunta: p, tipo: "opcion" as const, counts, total: items.length };
      }
      return { pregunta: p, tipo: "texto" as const, textos: items.map((i) => String(i.valor)), total: items.length };
    });
  }, [encuesta, respuestas]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }
  if (!encuesta) {
    return <div className="p-6 text-[var(--text-muted)]">Encuesta no encontrada.</div>;
  }

  const realCount = respuestas.filter((r) => Array.isArray(r.respuestas) && r.respuestas.length > 0).length;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-start gap-3">
        <Link href="/admin/encuestas"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Volver</Button></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">{encuesta.titulo}</h1>
          {encuesta.descripcion && <p className="text-[var(--text-muted)] text-sm mt-1">{encuesta.descripcion}</p>}
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {realCount} respuestas · {encuesta.anonima ? "Anónima" : "Nominal"} · {encuesta.estado}
          </p>
        </div>
      </div>

      {realCount === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart2 className="h-10 w-10 text-[var(--text-muted)] mx-auto mb-3" />
            <p className="text-[var(--text-muted)] text-sm">Aún no hay respuestas para analizar.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {stats?.map((s) => (
            <Card key={s.pregunta.idx}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{s.pregunta.idx + 1}. {s.pregunta.texto}</CardTitle>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{s.total} respuesta(s)</p>
              </CardHeader>
              <CardContent>
                {s.tipo === "escala" && (
                  <div className="space-y-2">
                    <p className="text-sm text-[var(--text-body)]">Media: <span className="font-bold text-[var(--text-dark)]">{s.media.toFixed(2)}</span> / 5</p>
                    {[1, 2, 3, 4, 5].map((n) => {
                      const count = s.dist[n - 1];
                      const pct = s.total > 0 ? (count / s.total) * 100 : 0;
                      return (
                        <div key={n} className="flex items-center gap-3 text-sm">
                          <span className="w-4 text-[var(--text-muted)] tabular-nums">{n}</span>
                          <ProgressBar value={pct} className="flex-1" />
                          <span className="w-12 text-right tabular-nums text-[var(--text-body)]">{count} ({pct.toFixed(0)}%)</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {s.tipo === "opcion" && (
                  <div className="space-y-2">
                    {Object.entries(s.counts).map(([opt, count]) => {
                      const pct = s.total > 0 ? (count / s.total) * 100 : 0;
                      return (
                        <div key={opt} className="flex items-center gap-3 text-sm">
                          <span className="flex-1 text-[var(--text-body)]">{opt}</span>
                          <ProgressBar value={pct} className="w-32" />
                          <span className="w-12 text-right tabular-nums text-[var(--text-body)]">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {s.tipo === "texto" && (
                  <ul className="space-y-2">
                    {s.textos.map((t, i) => (
                      <li key={i} className="rounded-md bg-[var(--muted)] px-3 py-2 text-sm text-[var(--text-body)]">{t}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
