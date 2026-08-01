"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type Tipo = "escala_1_5" | "texto";
interface Pregunta { idx: number; texto: string; tipo: Tipo; }
interface RespuestaItem { preguntaIdx: number; valor: number | string }
interface Evaluacion {
  id: string; ciclo: string; estado: "pendiente" | "completada";
  evaluadoA: { id: string; nombre: string; apellidos: string };
  evaluador: { id: string; nombre: string; apellidos: string };
  preguntas: Pregunta[]; respuestas: RespuestaItem[] | null;
  comentarios: string | null;
}

export default function EvaluacionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { toast } = useToast();
  const [ev, setEv] = useState<Evaluacion | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resp, setResp] = useState<Record<number, number | string>>({});
  const [comentarios, setComentarios] = useState("");

  const fetchOne = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/evaluaciones/${id}`);
      if (!r.ok) return;
      const d = await r.json();
      setEv(d.evaluacion);
      const init: Record<number, number | string> = {};
      (d.evaluacion?.respuestas as RespuestaItem[] | null ?? []).forEach((r) => { init[r.preguntaIdx] = r.valor; });
      setResp(init);
      setComentarios(d.evaluacion?.comentarios ?? "");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchOne(); }, [fetchOne]);

  const handleSave = async (completar: boolean) => {
    if (!ev) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/evaluaciones/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          respuestas: Object.entries(resp).map(([k, v]) => ({ preguntaIdx: Number(k), valor: v })),
          comentarios: comentarios || null,
          ...(completar ? { estado: "completada" } : {}),
        }),
      });
      if (!r.ok) { toast({ title: "Error", variant: "destructive" }); return; }
      toast({ title: completar ? "Evaluación completada" : "Guardado" });
      await fetchOne();
    } finally { setSaving(false); }
  };

  if (loading) return <div className="p-6 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /></div>;
  if (!ev) return <div className="p-6 text-[var(--text-muted)]">No encontrada.</div>;

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start gap-3">
        <Link href="/admin/evaluaciones"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Volver</Button></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">{ev.ciclo} · {ev.evaluadoA.nombre} {ev.evaluadoA.apellidos}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Evaluador: {ev.evaluador.nombre} {ev.evaluador.apellidos} · {ev.estado}</p>
        </div>
      </div>
      <Card>
        <CardContent className="pt-6 space-y-5">
          {ev.preguntas.map((p) => (
            <div key={p.idx} className="space-y-2">
              <p className="text-sm font-medium text-[var(--text-dark)]">{p.idx + 1}. {p.texto}</p>
              {p.tipo === "escala_1_5" ? (
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n} type="button"
                      onClick={() => setResp((prev) => ({ ...prev, [p.idx]: n }))}
                      disabled={ev.estado === "completada"}
                      className={`h-10 w-10 rounded-md border text-sm font-semibold ${resp[p.idx] === n ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-[var(--card)] text-[var(--text-body)] border-[var(--border)]"}`}
                    >{n}</button>
                  ))}
                </div>
              ) : (
                <textarea
                  className="w-full min-h-[80px] rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                  value={(resp[p.idx] as string) ?? ""}
                  onChange={(e) => setResp((prev) => ({ ...prev, [p.idx]: e.target.value }))}
                  disabled={ev.estado === "completada"}
                />
              )}
            </div>
          ))}
          <div>
            <p className="text-sm font-medium text-[var(--text-dark)] mb-2">Comentarios generales</p>
            <textarea
              className="w-full min-h-[80px] rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              value={comentarios}
              onChange={(e) => setComentarios(e.target.value)}
              disabled={ev.estado === "completada"}
            />
          </div>
          {ev.estado !== "completada" && (
            <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
              <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}><Save className="h-4 w-4 mr-1.5" /> Guardar borrador</Button>
              <Button onClick={() => handleSave(true)} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Completar</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
