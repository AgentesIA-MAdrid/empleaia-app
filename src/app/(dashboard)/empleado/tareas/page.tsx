"use client";

import { useEffect, useState } from "react";
import { CheckSquare, Square, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

interface Tarea { id: string; titulo: string; descripcion?: string; prioridad: string; completada: boolean; fechaLimite?: string; }

const PRIORIDAD_COLOR: Record<string, string> = {
  ALTA: "bg-red-100 text-red-700", MEDIA: "bg-amber-100 text-amber-700", BAJA: "bg-slate-100 text-slate-600",
};

export default function EmpleadoTareasPage() {
  const { toast } = useToast();
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    setLoading(true);
    fetch("/api/tareas?soloMias=true").then((r) => r.json()).then((d) => { setTareas(d.tareas || []); setLoading(false); });
  };

  useEffect(() => { fetchData(); }, []);

  const toggleCompletada = async (t: Tarea) => {
    await fetch(`/api/tareas/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completada: !t.completada }) });
    toast({ title: t.completada ? "Tarea reabierta" : "¡Tarea completada!" });
    fetchData();
  };

  const pendientes = tareas.filter((t) => !t.completada);
  const completadas = tareas.filter((t) => t.completada);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">
      <div><h1 className="text-2xl font-bold text-slate-900">Mis Tareas</h1><p className="text-slate-500 text-sm mt-1">{pendientes.length} pendientes · {completadas.length} completadas</p></div>
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : tareas.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><CheckSquare className="h-10 w-10 text-slate-200 mx-auto mb-3" /><p className="text-slate-400">No tienes tareas asignadas</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {[...pendientes, ...completadas].map((tarea) => (
            <div key={tarea.id} className={cn("flex items-start gap-3 p-4 rounded-xl border bg-white hover:shadow-sm transition-all", tarea.completada && "opacity-60")}>
              <button onClick={() => toggleCompletada(tarea)} className="mt-0.5 shrink-0">
                {tarea.completada ? <CheckSquare className="h-5 w-5 text-[var(--primary)]" /> : <Square className="h-5 w-5 text-slate-300 hover:text-[var(--primary-lighter)]" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={cn("font-medium text-slate-900", tarea.completada && "line-through text-slate-400")}>{tarea.titulo}</p>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", PRIORIDAD_COLOR[tarea.prioridad])}>{tarea.prioridad}</span>
                </div>
                {tarea.descripcion && <p className="text-sm text-slate-500 mt-0.5">{tarea.descripcion}</p>}
                {tarea.fechaLimite && (
                  <span className="flex items-center gap-1 text-xs text-slate-400 mt-1"><Calendar className="h-3 w-3" />{format(new Date(tarea.fechaLimite), "d MMM yyyy", { locale: es })}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
