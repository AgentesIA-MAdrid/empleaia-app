"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ClipboardList, Plus, Trash2, BarChart2, Lock, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type TipoPregunta = "escala_1_5" | "texto" | "opcion";
interface Pregunta { idx: number; texto: string; tipo: TipoPregunta; opciones?: string[]; }
interface Encuesta {
  id: string;
  titulo: string;
  descripcion: string | null;
  preguntas: Pregunta[];
  anonima: boolean;
  estado: "borrador" | "abierta" | "cerrada";
  cierraAt: string | null;
  creadoPor: { id: string; nombre: string; apellidos: string };
  _count: { respuestas: number };
  createdAt: string;
}

const ESTADO_CLS: Record<Encuesta["estado"], string> = {
  borrador: "bg-[var(--muted)] text-[var(--text-muted)]",
  abierta: "bg-[var(--success-bg)] text-[var(--success-text)]",
  cerrada: "bg-[var(--muted)] text-[var(--text-muted)]",
};

export default function AdminEncuestasPage() {
  const { toast } = useToast();
  const [encuestas, setEncuestas] = useState<Encuesta[]>([]);
  const [loading, setLoading] = useState(true);
  const [featureUnavailable, setFeatureUnavailable] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // form
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [anonima, setAnonima] = useState(true);
  const [cierraAt, setCierraAt] = useState("");
  const [preguntas, setPreguntas] = useState<Pregunta[]>([
    { idx: 0, texto: "", tipo: "escala_1_5" },
  ]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/encuestas");
      if (res.status === 402) {
        setFeatureUnavailable(true);
        return;
      }
      const data = await res.json();
      setEncuestas(data.encuestas ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const addPregunta = () =>
    setPreguntas((prev) => [...prev, { idx: prev.length, texto: "", tipo: "escala_1_5" }]);

  const updatePregunta = (idx: number, patch: Partial<Pregunta>) =>
    setPreguntas((prev) => prev.map((p) => (p.idx === idx ? { ...p, ...patch } : p)));

  const removePregunta = (idx: number) =>
    setPreguntas((prev) => prev.filter((p) => p.idx !== idx).map((p, i) => ({ ...p, idx: i })));

  const handleCreate = async () => {
    if (!titulo.trim()) {
      toast({ title: "Falta título", variant: "destructive" });
      return;
    }
    const preguntasOK = preguntas.every((p) => p.texto.trim().length > 0);
    if (!preguntasOK) {
      toast({ title: "Cada pregunta necesita texto", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/encuestas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: titulo.trim(),
          descripcion: descripcion.trim() || null,
          anonima,
          cierraAt: cierraAt ? new Date(cierraAt).toISOString() : null,
          preguntas: preguntas.map((p, i) => ({
            idx: i,
            texto: p.texto.trim(),
            tipo: p.tipo,
            ...(p.tipo === "opcion" && p.opciones ? { opciones: p.opciones } : {}),
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Error", description: body?.error ?? "No se pudo crear", variant: "destructive" });
        return;
      }
      toast({ title: "Encuesta creada" });
      setDialogOpen(false);
      setTitulo(""); setDescripcion(""); setAnonima(true); setCierraAt("");
      setPreguntas([{ idx: 0, texto: "", tipo: "escala_1_5" }]);
      await fetchAll();
    } finally {
      setCreating(false);
    }
  };

  const handleEstado = async (id: string, estado: Encuesta["estado"]) => {
    const res = await fetch(`/api/encuestas/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
    });
    if (res.ok) {
      const data = await res.json();
      setEncuestas((prev) => prev.map((e) => (e.id === id ? { ...e, ...data.encuesta } : e)));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Borrar la encuesta y todas sus respuestas?")) return;
    const res = await fetch(`/api/encuestas/${id}`, { method: "DELETE" });
    if (res.ok) {
      setEncuestas((prev) => prev.filter((e) => e.id !== id));
      toast({ title: "Encuesta borrada" });
    }
  };

  if (featureUnavailable) {
    return (
      <div className="p-6">
        <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-[var(--warning-text)] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--warning-text)]">Encuestas de clima — plan Pro o superior</p>
              <p className="text-sm text-[var(--warning-text)] mt-0.5">Lanza encuestas anónimas para medir el clima laboral y obtener feedback del equipo.</p>
            </div>
            <Link href="/admin/planes"><Button size="sm">Ver planes</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
            <ClipboardList className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-dark)]">Encuestas de clima</h1>
            <p className="text-[var(--text-muted)] text-sm mt-0.5">Lanza encuestas y mide el feedback del equipo</p>
          </div>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Nueva encuesta
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /></div>
      ) : encuestas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardList className="h-10 w-10 text-[var(--text-muted)] mx-auto mb-3" />
            <p className="text-[var(--text-muted)] text-sm">Aún no hay encuestas. Crea la primera.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {encuestas.map((e) => (
            <Card key={e.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base leading-snug">{e.titulo}</CardTitle>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {e.preguntas.length} pregunta(s) · {e.anonima ? "Anónima" : "Nominal"}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${ESTADO_CLS[e.estado]}`}>
                    {e.estado}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-3">
                {e.descripcion && <p className="text-sm text-[var(--text-body)] line-clamp-3">{e.descripcion}</p>}
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <BarChart2 className="h-3.5 w-3.5" />
                  <span className="font-semibold">{e._count.respuestas}</span> respuestas
                  {e.cierraAt && (
                    <span className="ml-auto text-[var(--text-muted)]">
                      Cierra {format(new Date(e.cierraAt), "dd MMM", { locale: es })}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-auto pt-2 border-t border-[var(--border)]">
                  <Link href={`/admin/encuestas/${e.id}`}>
                    <Button size="sm" variant="ghost">Ver resultados</Button>
                  </Link>
                  {e.estado === "abierta" ? (
                    <Button size="sm" variant="ghost" className="text-[var(--text-muted)]" onClick={() => handleEstado(e.id, "cerrada")}>
                      <XCircle className="h-4 w-4 mr-1" /> Cerrar
                    </Button>
                  ) : e.estado === "borrador" ? (
                    <Button size="sm" variant="ghost" className="text-[var(--success-text)]" onClick={() => handleEstado(e.id, "abierta")}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Abrir
                    </Button>
                  ) : null}
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" className="text-[var(--danger)]" onClick={() => handleDelete(e.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Nueva encuesta</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <div>
              <Label>Título</Label>
              <Input className="mt-1" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Encuesta de clima Q1" />
            </div>
            <div>
              <Label>Descripción (opcional)</Label>
              <textarea
                className="mt-1 w-full min-h-[80px] rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cierre (opcional)</Label>
                <Input className="mt-1" type="datetime-local" value={cierraAt} onChange={(e) => setCierraAt(e.target.value)} />
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={anonima ? "si" : "no"} onValueChange={(v) => setAnonima(v === "si")}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="si">Anónima (recomendada)</SelectItem>
                    <SelectItem value="no">Nominal (sabes quién responde)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Preguntas</Label>
                <Button size="sm" variant="outline" onClick={addPregunta}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Añadir
                </Button>
              </div>
              <div className="space-y-3">
                {preguntas.map((p) => (
                  <div key={p.idx} className="rounded-lg border border-[var(--border)] p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-semibold text-[var(--text-muted)] mt-2 w-6">{p.idx + 1}.</span>
                      <Input
                        className="flex-1"
                        value={p.texto}
                        onChange={(e) => updatePregunta(p.idx, { texto: e.target.value })}
                        placeholder="¿Cómo valoras tu carga de trabajo?"
                      />
                      <Select value={p.tipo} onValueChange={(v: TipoPregunta) => updatePregunta(p.idx, { tipo: v, opciones: v === "opcion" ? ["", ""] : undefined })}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="escala_1_5">Escala 1-5</SelectItem>
                          <SelectItem value="texto">Texto libre</SelectItem>
                          <SelectItem value="opcion">Opción múltiple</SelectItem>
                        </SelectContent>
                      </Select>
                      {preguntas.length > 1 && (
                        <Button size="sm" variant="ghost" className="text-[var(--danger)]" onClick={() => removePregunta(p.idx)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    {p.tipo === "opcion" && (
                      <div className="pl-8 space-y-1">
                        {(p.opciones ?? []).map((o, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              value={o}
                              onChange={(e) => {
                                const next = [...(p.opciones ?? [])];
                                next[i] = e.target.value;
                                updatePregunta(p.idx, { opciones: next });
                              }}
                              placeholder={`Opción ${i + 1}`}
                            />
                            {(p.opciones ?? []).length > 2 && (
                              <Button size="sm" variant="ghost" className="text-[var(--danger)]" onClick={() => {
                                const next = (p.opciones ?? []).filter((_, j) => j !== i);
                                updatePregunta(p.idx, { opciones: next });
                              }}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        ))}
                        <Button size="sm" variant="outline" className="ml-auto" onClick={() => {
                          updatePregunta(p.idx, { opciones: [...(p.opciones ?? []), ""] });
                        }}>
                          <Plus className="h-3 w-3 mr-1" /> Añadir opción
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
