"use client";

/**
 * Tab "Calendario" en /admin/configuracion. Plan Fase 6 §3.4 + §5.
 *
 * Cubre:
 *  - Festivos: lista + crear + eliminar.
 *  - Días laborables: checkboxes Lun-Dom.
 *  - Zona horaria: input/select texto libre con validación cliente.
 *
 * NO usa feature gate — todos los planes tienen calendario.
 */

import { useEffect, useState } from "react";
import { Calendar, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type Festivo = {
  id: string;
  nombre: string;
  fecha: string;
  ambito: string;
  tiendaId?: string | null;
  tienda?: { id: string; nombre: string } | null;
};
type Tienda = { id: string; nombre: string };

const DAYS = [
  { idx: 1, label: "Lun" },
  { idx: 2, label: "Mar" },
  { idx: 3, label: "Mié" },
  { idx: 4, label: "Jue" },
  { idx: 5, label: "Vie" },
  { idx: 6, label: "Sáb" },
  { idx: 0, label: "Dom" },
] as const;

export function CalendarioTab({
  zonaHoraria,
  diasLaborables,
  onUpdateConfig,
}: {
  zonaHoraria: string;
  diasLaborables: number[];
  onUpdateConfig: (patch: { zonaHoraria?: string; diasLaborables?: number[] }) => void;
}) {
  const { toast } = useToast();
  const [festivos, setFestivos] = useState<Festivo[]>([]);
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevaFecha, setNuevaFecha] = useState("");
  const [nuevoAmbito, setNuevoAmbito] = useState<"nacional" | "local">("nacional");
  const [nuevaTiendaId, setNuevaTiendaId] = useState("");

  async function cargarFestivos() {
    try {
      const r = await fetch("/api/festivos");
      if (!r.ok) return;
      const data = (await r.json()) as { festivos: Festivo[] };
      setFestivos(data.festivos);
    } catch {
      // ignorar — UI no rompe
    }
  }

  useEffect(() => {
    // cargarFestivos() hace setState tras un await (fetch), no de forma síncrona.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarFestivos();
  }, []);

  async function agregarFestivo() {
    if (!nuevoNombre || !nuevaFecha) return;
    if (nuevoAmbito === "local" && !nuevaTiendaId) {
      toast({ title: "Elige la sede del festivo local", variant: "destructive" });
      return;
    }
    const r = await fetch("/api/festivos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nombre: nuevoNombre,
        fecha: nuevaFecha,
        ambito: nuevoAmbito,
        tiendaId: nuevoAmbito === "local" ? nuevaTiendaId : null,
      }),
    });
    if (r.ok) {
      setNuevoNombre("");
      setNuevaFecha("");
      setNuevoAmbito("nacional");
      setNuevaTiendaId("");
      void cargarFestivos();
      toast({ title: "Festivo añadido" });
    } else {
      toast({ title: "Error al crear festivo", variant: "destructive" });
    }
  }

  async function eliminarFestivo(id: string) {
    const r = await fetch(`/api/festivos?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (r.ok) {
      setFestivos((arr) => arr.filter((f) => f.id !== id));
      toast({ title: "Festivo eliminado" });
    }
  }

  function toggleDia(idx: number) {
    const set = new Set(diasLaborables);
    if (set.has(idx)) set.delete(idx);
    else set.add(idx);
    const ordered = [...set].sort((a, b) => a - b);
    onUpdateConfig({ diasLaborables: ordered });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-indigo-600" /> Días laborables
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-muted)] mb-3">
            Días en que tus empleados deben fichar normalmente.
          </p>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map((d) => {
              const active = diasLaborables.includes(d.idx);
              return (
                <button
                  key={d.idx}
                  type="button"
                  onClick={() => toggleDia(d.idx)}
                  className={
                    active
                      ? "px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium"
                      : "px-4 py-2 rounded-lg bg-[var(--muted)] text-[var(--text-body)] text-sm font-medium hover:bg-gray-200"
                  }
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-indigo-600" /> Zona horaria
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Label>IANA Time Zone</Label>
          <Input
            className="mt-1 font-mono text-sm"
            value={zonaHoraria}
            onChange={(e) => onUpdateConfig({ zonaHoraria: e.target.value })}
            placeholder="Europe/Madrid"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Solo afecta cómo se muestran fechas en informes y exports. NO
            afecta el cálculo de quotas (sigue en hora del servidor).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-indigo-600" /> Festivos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Label>Nombre</Label>
              <Input
                className="mt-1"
                placeholder="Día de Andalucía"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
              />
            </div>
            <div>
              <Label>Fecha</Label>
              <Input
                type="date"
                className="mt-1"
                value={nuevaFecha}
                onChange={(e) => setNuevaFecha(e.target.value)}
              />
            </div>
            <div className="min-w-[140px]">
              <Label>Ámbito</Label>
              <Select
                value={nuevoAmbito}
                onValueChange={(v) => {
                  const ambito = v as "nacional" | "local";
                  setNuevoAmbito(ambito);
                  // Las sedes solo hacen falta para un festivo local; se cargan
                  // bajo demanda (evita un fetch en el montaje del tab).
                  if (ambito === "local" && tiendas.length === 0) {
                    fetch("/api/tiendas")
                      .then((r) => (r.ok ? r.json() : { tiendas: [] }))
                      .then((data: { tiendas: Tienda[] }) => setTiendas(data.tiendas ?? []))
                      .catch(() => undefined);
                  }
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nacional">Nacional</SelectItem>
                  <SelectItem value="local">Local (sede)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {nuevoAmbito === "local" && (
              <div className="min-w-[160px]">
                <Label>Sede</Label>
                <Select value={nuevaTiendaId} onValueChange={setNuevaTiendaId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Selecciona sede…" />
                  </SelectTrigger>
                  <SelectContent>
                    {tiendas.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button onClick={agregarFestivo} disabled={!nuevoNombre || !nuevaFecha}>
              <Plus className="h-4 w-4 mr-1" /> Añadir
            </Button>
          </div>

          <div className="space-y-1">
            {festivos.length === 0 && (
              <p className="text-sm text-[var(--text-muted)] italic">Sin festivos definidos.</p>
            )}
            {festivos.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between py-2 border-b border-[var(--border)]"
              >
                <div>
                  <span className="text-sm font-medium text-[var(--text-dark)]">
                    {f.nombre}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] ml-2">
                    {f.fecha.slice(0, 10)} ·{" "}
                    {f.ambito === "local"
                      ? `Local${f.tienda ? ` — ${f.tienda.nombre}` : ""}`
                      : "Nacional"}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[var(--danger)]"
                  onClick={() => eliminarFestivo(f.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
