"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

interface Tramo {
  horaApertura: string;
  horaCierre: string;
}
type TramosPorDia = Record<number, Tramo[]>;

const vacio = (): TramosPorDia => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });

// Presets de horario. "auto": eliges uno y rellena los tramos; luego puedes
// editarlos a mano. Días: 0=Lunes … 5=Sábado, 6=Domingo.
const PRESETS: Record<string, { label: string; build: () => TramosPorDia }> = {
  centro: {
    label: "Centro comercial — L–S 10–16 y 16–22 (turno partido), domingo 11–21",
    build: () => {
      const n = vacio();
      // Lunes a sábado (0–5): dos tramos para cubrir turno de mañana y de
      // tarde con relevo (10–16 y 16–22).
      for (let d = 0; d < 6; d++) {
        n[d] = [
          { horaApertura: "10:00", horaCierre: "16:00" },
          { horaApertura: "16:00", horaCierre: "22:00" },
        ];
      }
      // Domingo (6): horario reducido de un tramo.
      n[6] = [{ horaApertura: "11:00", horaCierre: "21:00" }];
      return n;
    },
  },
  calle_invierno: {
    label: "Pie de calle · invierno — 10–14 y 17–20 (V mañana hasta 13:30, S solo mañana)",
    build: () => {
      const n = vacio();
      // L–J: mañana 10–14 + tarde 17–20.
      for (let d = 0; d < 4; d++) {
        n[d] = [
          { horaApertura: "10:00", horaCierre: "14:00" },
          { horaApertura: "17:00", horaCierre: "20:00" },
        ];
      }
      // Viernes: mañana hasta 13:30 + tarde igual.
      n[4] = [
        { horaApertura: "10:00", horaCierre: "13:30" },
        { horaApertura: "17:00", horaCierre: "20:00" },
      ];
      // Sábado: solo mañana hasta 13:30.
      n[5] = [{ horaApertura: "10:00", horaCierre: "13:30" }];
      return n;
    },
  },
  calle_verano: {
    label: "Pie de calle · verano — 10–14 y 17:30–20:30 (V mañana hasta 13:30, S solo mañana)",
    build: () => {
      const n = vacio();
      // L–J: mañana 10–14 + tarde 17:30–20:30.
      for (let d = 0; d < 4; d++) {
        n[d] = [
          { horaApertura: "10:00", horaCierre: "14:00" },
          { horaApertura: "17:30", horaCierre: "20:30" },
        ];
      }
      // Viernes: mañana hasta 13:30 + tarde igual.
      n[4] = [
        { horaApertura: "10:00", horaCierre: "13:30" },
        { horaApertura: "17:30", horaCierre: "20:30" },
      ];
      // Sábado: solo mañana hasta 13:30.
      n[5] = [{ horaApertura: "10:00", horaCierre: "13:30" }];
      return n;
    },
  },
};

export function SedeHorariosDialog({
  tienda,
  otrasSedes = [],
  onClose,
}: {
  tienda: { id: string; nombre: string } | null;
  otrasSedes?: { id: string; nombre: string }[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [tramos, setTramos] = useState<TramosPorDia>(vacio);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // "Aplicar a otras sedes": ids seleccionados para replicar el mismo horario.
  const [replicarIds, setReplicarIds] = useState<Set<string>>(new Set());
  const [replicando, setReplicando] = useState(false);

  useEffect(() => {
    if (!tienda) return;
    setReplicarIds(new Set());
    setLoading(true);
    fetch(`/api/tiendas/${tienda.id}/horarios`)
      .then((r) => r.json())
      .then((d) => {
        const next = vacio();
        for (const t of d.tramos ?? []) {
          (next[t.diaSemana] ??= []).push({
            horaApertura: t.horaApertura,
            horaCierre: t.horaCierre,
          });
        }
        setTramos(next);
      })
      .catch(() => toast({ title: "Error al cargar horarios", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [tienda, toast]);

  const addTramo = (dia: number) =>
    setTramos((p) => ({ ...p, [dia]: [...p[dia], { horaApertura: "09:00", horaCierre: "20:00" }] }));

  const removeTramo = (dia: number, idx: number) =>
    setTramos((p) => ({ ...p, [dia]: p[dia].filter((_, i) => i !== idx) }));

  const setTramo = (dia: number, idx: number, campo: keyof Tramo, valor: string) =>
    setTramos((p) => ({
      ...p,
      [dia]: p[dia].map((t, i) => (i === idx ? { ...t, [campo]: valor } : t)),
    }));

  const copiarATodos = (dia: number) =>
    setTramos((p) => {
      const fuente = p[dia].map((t) => ({ ...t }));
      const next = vacio();
      for (let d = 0; d < 7; d++) next[d] = fuente.map((t) => ({ ...t }));
      return next;
    });

  // Valida apertura < cierre en todos los tramos. Devuelve el día inválido o null.
  const validar = (): number | null => {
    for (let d = 0; d < 7; d++) {
      for (const t of tramos[d]) {
        if (t.horaApertura >= t.horaCierre) return d;
      }
    }
    return null;
  };

  const buildPayload = () => ({
    tramos: Object.entries(tramos).flatMap(([dia, lista]) =>
      lista.map((t) => ({ diaSemana: Number(dia), ...t })),
    ),
  });

  const putHorarios = async (sedeId: string, payload: ReturnType<typeof buildPayload>) => {
    const res = await fetch(`/api/tiendas/${sedeId}/horarios`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || "Error");
    }
  };

  const guardar = async () => {
    if (!tienda) return;
    const invalido = validar();
    if (invalido !== null) {
      toast({ title: `${DIAS[invalido]}: la apertura debe ser anterior al cierre`, variant: "destructive" });
      return;
    }
    const payload = buildPayload();
    setSaving(true);
    try {
      await putHorarios(tienda.id, payload);
      // Replicar el mismo horario a las sedes seleccionadas (best-effort:
      // reporta cuántas fallaron sin abortar el guardado principal).
      let fallidas = 0;
      if (replicarIds.size > 0) {
        setReplicando(true);
        const resultados = await Promise.allSettled(
          [...replicarIds].map((id) => putHorarios(id, payload)),
        );
        fallidas = resultados.filter((r) => r.status === "rejected").length;
      }
      if (replicarIds.size > 0) {
        const ok = replicarIds.size - fallidas;
        toast({
          title: `Horarios guardados y aplicados a ${ok} sede${ok === 1 ? "" : "s"}${fallidas ? ` (${fallidas} con error)` : ""}`,
          variant: fallidas ? "destructive" : undefined,
        });
      } else {
        toast({ title: "Horarios guardados" });
      }
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
      setReplicando(false);
    }
  };

  return (
    <Dialog open={!!tienda} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Horarios — {tienda?.nombre}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-3 py-1">
            {/* Preset automático — rellena los tramos; luego se pueden editar. */}
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <label className="text-xs font-medium text-slate-600">
                Aplicar horario tipo <span className="font-normal text-slate-400">(puedes editarlo después)</span>
              </label>
              <select
                value=""
                onChange={(e) => {
                  const p = PRESETS[e.target.value];
                  if (p) setTramos(p.build());
                }}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              >
                <option value="">Selecciona un preset…</option>
                {Object.entries(PRESETS).map(([k, p]) => (
                  <option key={k} value={k}>{p.label}</option>
                ))}
              </select>
            </div>
            {DIAS.map((nombre, dia) => (
              <div key={dia} className="rounded-lg border border-slate-100 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-800">{nombre}</span>
                  <div className="flex items-center gap-2">
                    {tramos[dia].length > 0 && (
                      <button
                        type="button"
                        onClick={() => copiarATodos(dia)}
                        className="text-xs text-slate-500 hover:text-[var(--primary)] inline-flex items-center gap-1"
                        title="Copiar este horario a todos los días"
                      >
                        <Copy className="h-3 w-3" /> A todos
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => addTramo(dia)}
                      className="text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" /> Tramo
                    </button>
                  </div>
                </div>
                {tramos[dia].length === 0 ? (
                  <p className="text-xs text-slate-400">Cerrado</p>
                ) : (
                  <div className="space-y-2">
                    {tramos[dia].map((t, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={t.horaApertura}
                          onChange={(e) => setTramo(dia, idx, "horaApertura", e.target.value)}
                          className="h-9 w-32"
                        />
                        <span className="text-slate-400">–</span>
                        <Input
                          type="time"
                          value={t.horaCierre}
                          onChange={(e) => setTramo(dia, idx, "horaCierre", e.target.value)}
                          className="h-9 w-32"
                        />
                        <button
                          type="button"
                          onClick={() => removeTramo(dia, idx)}
                          className="text-slate-400 hover:text-red-500 ml-auto"
                          title="Eliminar tramo"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Aplicar el mismo horario a otras sedes de una vez. */}
            {otrasSedes.length > 0 && (
              <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600">
                    Aplicar este horario también a otras sedes
                  </label>
                  {replicarIds.size < otrasSedes.length ? (
                    <button
                      type="button"
                      onClick={() => setReplicarIds(new Set(otrasSedes.map((s) => s.id)))}
                      className="text-xs text-[var(--primary)] hover:underline"
                    >
                      Seleccionar todas
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setReplicarIds(new Set())}
                      className="text-xs text-slate-500 hover:underline"
                    >
                      Quitar todas
                    </button>
                  )}
                </div>
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {otrasSedes.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={replicarIds.has(s.id)}
                        onChange={(e) =>
                          setReplicarIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(s.id);
                            else next.delete(s.id);
                            return next;
                          })
                        }
                        className="h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]"
                      />
                      {s.nombre}
                    </label>
                  ))}
                </div>
                {replicarIds.size > 0 && (
                  <p className="mt-1.5 text-xs text-slate-400">
                    Al guardar, este horario se aplicará también a {replicarIds.size} sede
                    {replicarIds.size === 1 ? "" : "s"} (reemplaza el suyo).
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={guardar} disabled={saving || loading}>
            {saving
              ? replicando
                ? "Aplicando…"
                : "Guardando…"
              : replicarIds.size > 0
                ? `Guardar y aplicar a ${replicarIds.size + 1} sedes`
                : "Guardar horarios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
