"use client";

import { useEffect, useState, useCallback } from "react";
import { ClipboardList, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type TipoPregunta = "escala_1_5" | "texto" | "opcion";
interface Pregunta { idx: number; texto: string; tipo: TipoPregunta; opciones?: string[]; }
interface Encuesta {
  id: string; titulo: string; descripcion: string | null;
  preguntas: Pregunta[]; anonima: boolean; cierraAt: string | null;
  yaRespondida: boolean;
}

export default function EmpleadoEncuestasPage() {
  const { toast } = useToast();
  const [encuestas, setEncuestas] = useState<Encuesta[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [respuestas, setRespuestas] = useState<Record<number, number | string>>({});
  const [sending, setSending] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/encuestas");
      if (res.status === 402) { setEncuestas([]); return; }
      const data = await res.json();
      setEncuestas(data.encuestas ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const activeEncuesta = encuestas.find((e) => e.id === activeId) ?? null;

  const handleStart = (enc: Encuesta) => {
    setActiveId(enc.id);
    setRespuestas({});
  };

  const handleSubmit = async () => {
    if (!activeEncuesta) return;
    // Validar todas respondidas
    const todasRespondidas = activeEncuesta.preguntas.every((p) => {
      const v = respuestas[p.idx];
      if (p.tipo === "escala_1_5") return typeof v === "number" && v >= 1 && v <= 5;
      if (p.tipo === "texto") return typeof v === "string" && v.trim().length > 0;
      if (p.tipo === "opcion") return typeof v === "string" && v.length > 0;
      return false;
    });
    if (!todasRespondidas) {
      toast({ title: "Responde todas las preguntas", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/encuestas/${activeEncuesta.id}/responder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          respuestas: Object.entries(respuestas).map(([k, v]) => ({ preguntaIdx: Number(k), valor: v })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Error", description: body?.error ?? "No se pudo enviar", variant: "destructive" });
        return;
      }
      toast({ title: "¡Gracias por tu respuesta!" });
      setActiveId(null);
      await fetchAll();
    } finally {
      setSending(false);
    }
  };

  if (activeEncuesta) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setActiveId(null)}>← Volver</Button>
        <Card>
          <CardHeader>
            <CardTitle>{activeEncuesta.titulo}</CardTitle>
            {activeEncuesta.descripcion && (
              <p className="text-sm text-[var(--text-muted)] mt-1">{activeEncuesta.descripcion}</p>
            )}
            <p className="text-xs text-[var(--text-muted)] mt-2">
              {activeEncuesta.anonima ? "Esta encuesta es anónima — tu identidad no se asocia a la respuesta." : "Esta encuesta NO es anónima — quien la creó verá tu nombre."}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {activeEncuesta.preguntas.map((p) => (
              <div key={p.idx} className="space-y-2">
                <p className="text-sm font-medium text-[var(--text-dark)]">{p.idx + 1}. {p.texto}</p>
                {p.tipo === "escala_1_5" && (
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setRespuestas((prev) => ({ ...prev, [p.idx]: n }))}
                        className={`h-10 w-10 rounded-md border text-sm font-semibold transition ${
                          respuestas[p.idx] === n
                            ? "bg-[var(--primary)] text-white border-[var(--primary)]"
                            : "bg-[var(--card)] text-[var(--text-body)] border-[var(--border)] hover:border-[var(--border-strong)]"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <span className="text-xs text-[var(--text-muted)] ml-2">1 = poco · 5 = mucho</span>
                  </div>
                )}
                {p.tipo === "texto" && (
                  <textarea
                    className="w-full min-h-[80px] rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    value={(respuestas[p.idx] as string) ?? ""}
                    onChange={(e) => setRespuestas((prev) => ({ ...prev, [p.idx]: e.target.value }))}
                  />
                )}
                {p.tipo === "opcion" && p.opciones && (
                  <div className="space-y-1">
                    {p.opciones.map((opt) => (
                      <label key={opt} className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 cursor-pointer hover:bg-[var(--muted)]">
                        <Input
                          type="radio"
                          name={`q-${p.idx}`}
                          className="h-4 w-4"
                          checked={respuestas[p.idx] === opt}
                          onChange={() => setRespuestas((prev) => ({ ...prev, [p.idx]: opt }))}
                        />
                        <span className="text-sm">{opt}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <Button onClick={handleSubmit} disabled={sending} className="w-full">
              {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Enviar respuestas
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <ClipboardList className="h-5 w-5 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">Encuestas</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Tu opinión cuenta — ayuda a mejorar la empresa</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /></div>
      ) : encuestas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardList className="h-10 w-10 text-[var(--text-muted)] mx-auto mb-3" />
            <p className="text-[var(--text-muted)] text-sm">No hay encuestas activas.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {encuestas.map((e) => (
            <Card key={e.id}>
              <CardContent className="pt-4 pb-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[var(--text-dark)]">{e.titulo}</p>
                  {e.descripcion && <p className="text-sm text-[var(--text-muted)] mt-0.5 line-clamp-2">{e.descripcion}</p>}
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {e.preguntas.length} pregunta(s) · {e.anonima ? "Anónima" : "Nominal"}
                  </p>
                </div>
                {e.yaRespondida ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-[var(--success-bg)] text-[var(--success-text)]">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Respondida
                  </span>
                ) : (
                  <Button size="sm" onClick={() => handleStart(e)}>Responder</Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
