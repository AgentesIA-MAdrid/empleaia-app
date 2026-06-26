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
    label: "Centro comercial — 10:00 a 22:00 (todos los días)",
    build: () => {
      const n = vacio();
      for (let d = 0; d < 7; d++) n[d] = [{ horaApertura: "10:00", horaCierre: "22:00" }];
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
  onClose,
}: {
  tienda: { id: string; nombre: string } | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [tramos, setTramos] = useState<TramosPorDia>(vacio);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tienda) return;
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

  const guardar = async () => {
    if (!tienda) return;
    // Validación cliente: apertura < cierre en cada tramo.
    for (let d = 0; d < 7; d++) {
      for (const t of tramos[d]) {
        if (t.horaApertura >= t.horaCierre) {
          toast({
            title: `${DIAS[d]}: la apertura debe ser anterior al cierre`,
            variant: "destructive",
          });
          return;
        }
      }
    }
    const payload = {
      tramos: Object.entries(tramos).flatMap(([dia, lista]) =>
        lista.map((t) => ({ diaSemana: Number(dia), ...t })),
      ),
    };
    setSaving(true);
    try {
      const res = await fetch(`/api/tiendas/${tienda.id}/horarios`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Error");
      }
      toast({ title: "Horarios guardados" });
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
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
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={guardar} disabled={saving || loading}>
            {saving ? "Guardando…" : "Guardar horarios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
