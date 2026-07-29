"use client";

/**
 * Tab "Checklist" en /admin/configuracion — ticket c4bc33d6.
 *
 * Define los puntos de control que el empleado debe confirmar antes de
 * fichar la entrada y antes de fichar la salida (stock y caja del turno
 * anterior, estado de la tienda, cierre de caja…). Con el interruptor
 * apagado no se le pide nada al empleado.
 *
 * NO usa feature gate: el fichaje y sus controles son CORE (RD 8/2019).
 */

import { useEffect, useState } from "react";
import { ClipboardCheck, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type Tipo = "ENTRADA" | "SALIDA";

type ItemServidor = {
  id: string;
  tipo: Tipo;
  texto: string;
  orden: number;
  activo: boolean;
};

/** Item en edición: `key` es local (React), `id` null = alta nueva. */
type ItemEdit = {
  key: string;
  id: string | null;
  tipo: Tipo;
  texto: string;
  activo: boolean;
};

const TIPOS: { tipo: Tipo; titulo: string; ayuda: string }[] = [
  {
    tipo: "ENTRADA",
    titulo: "Al fichar la entrada",
    ayuda: "Lo que el empleado confirma al empezar su turno.",
  },
  {
    tipo: "SALIDA",
    titulo: "Al fichar la salida",
    ayuda: "Lo que el empleado confirma antes de irse.",
  },
];

let contadorKeys = 0;
function nuevaKey(): string {
  contadorKeys += 1;
  return `nuevo_${contadorKeys}`;
}

export function ChecklistFichajeTab() {
  const { toast } = useToast();
  const [activo, setActivo] = useState(false);
  const [items, setItems] = useState<ItemEdit[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    try {
      const r = await fetch("/api/checklist-fichaje?todos=1");
      if (!r.ok) return;
      const data = (await r.json()) as { activo: boolean; items: ItemServidor[] };
      setActivo(!!data.activo);
      setItems(
        (data.items ?? []).map((i) => ({
          key: i.id,
          id: i.id,
          tipo: i.tipo,
          texto: i.texto,
          activo: i.activo,
        })),
      );
    } catch {
      // ignorar — la UI no rompe
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    // cargar() hace setState tras un await (fetch), no de forma síncrona.
    void cargar();
  }, []);

  function añadir(tipo: Tipo) {
    setItems((arr) => [...arr, { key: nuevaKey(), id: null, tipo, texto: "", activo: true }]);
  }

  function editar(key: string, texto: string) {
    setItems((arr) => arr.map((i) => (i.key === key ? { ...i, texto } : i)));
  }

  function eliminar(key: string) {
    setItems((arr) => arr.filter((i) => i.key !== key));
  }

  async function guardar() {
    const limpios = items.map((i) => ({ ...i, texto: i.texto.trim() }));
    if (limpios.some((i) => i.texto.length < 3)) {
      toast({
        title: "Hay puntos vacíos",
        description: "Escribe el texto de cada comprobación (mínimo 3 caracteres) o elimínala.",
        variant: "destructive",
      });
      return;
    }
    setGuardando(true);
    try {
      const r = await fetch("/api/checklist-fichaje", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activo,
          items: limpios.map((i, idx) => ({
            id: i.id,
            tipo: i.tipo,
            texto: i.texto,
            // El orden dentro de cada tipo lo marca la posición en la lista.
            orden: limpios.filter((o, j) => o.tipo === i.tipo && j < idx).length,
            activo: i.activo,
          })),
        }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        error?: string;
        activo?: boolean;
        items?: ItemServidor[];
      };
      if (!r.ok) {
        toast({
          title: "No se pudo guardar",
          description: data.error ?? "Error desconocido",
          variant: "destructive",
        });
        return;
      }
      setActivo(!!data.activo);
      setItems(
        (data.items ?? []).map((i) => ({
          key: i.id,
          id: i.id,
          tipo: i.tipo,
          texto: i.texto,
          activo: i.activo,
        })),
      );
      toast({ title: "Checklist guardado" });
    } catch {
      toast({ title: "No se pudo guardar", variant: "destructive" });
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) {
    return <div className="h-40 bg-slate-100 rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-5 w-5 text-[var(--primary)]" />
            Comprobaciones al fichar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
            />
            <span>
              <strong className="block text-slate-900">
                Pedir las comprobaciones al fichar
              </strong>
              <span className="text-slate-500">
                Antes de registrar la entrada o la salida, el empleado tiene que
                marcar todos los puntos de su lista. Queda guardado junto al
                fichaje.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      {TIPOS.map(({ tipo, titulo, ayuda }) => {
        const propios = items.filter((i) => i.tipo === tipo);
        return (
          <Card key={tipo}>
            <CardHeader>
              <CardTitle className="text-base">{titulo}</CardTitle>
              <p className="text-sm text-slate-500">{ayuda}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {propios.length === 0 && (
                <p className="text-sm text-slate-400">
                  Sin comprobaciones: no se le pedirá nada al fichar la{" "}
                  {tipo === "SALIDA" ? "salida" : "entrada"}.
                </p>
              )}
              {propios.map((item, idx) => (
                <div key={item.key} className="flex items-center gap-2">
                  <Label className="sr-only" htmlFor={`chk_${item.key}`}>
                    Comprobación {idx + 1}
                  </Label>
                  <Input
                    id={`chk_${item.key}`}
                    value={item.texto}
                    maxLength={200}
                    placeholder="Ej.: He revisado el stock del turno anterior"
                    onChange={(e) => editar(item.key, e.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Eliminar comprobación"
                    onClick={() => eliminar(item.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => añadir(tipo)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Añadir comprobación
              </Button>
            </CardContent>
          </Card>
        );
      })}

      <div className="flex justify-end">
        <Button onClick={() => void guardar()} disabled={guardando}>
          <Save className="h-4 w-4 mr-2" />
          {guardando ? "Guardando…" : "Guardar checklist"}
        </Button>
      </div>
    </div>
  );
}
