"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Loader2, Trash2, SlidersHorizontal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

interface Campo {
  id: string;
  clave: string;
  etiqueta: string;
  tipo: string;
  orden: number;
}

const TIPO_INPUT: Record<string, string> = {
  texto: "text",
  numero: "number",
  fecha: "date",
};

/**
 * Campos personalizados de la ficha del empleado. El OWNER puede definir
 * nuevos campos (aplican a todos los empleados) y rellenar su valor para
 * este empleado. MANAGER lo ve en solo lectura.
 */
export function CamposPersonalizadosFicha({
  empleadoId,
  puedeEditar,
}: {
  empleadoId: string;
  puedeEditar: boolean;
}) {
  const { toast } = useToast();
  const [campos, setCampos] = useState<Campo[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState("");
  const [nuevoTipo, setNuevoTipo] = useState("texto");
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/empleados/${empleadoId}/campos-personalizados`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { campos: Campo[]; valores: Record<string, string> };
      setCampos(data.campos);
      setValores(data.valores);
    } catch {
      toast({ title: "No se pudieron cargar los campos personalizados", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [empleadoId, toast]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const guardarValores = async () => {
    setGuardando(true);
    try {
      const res = await fetch(`/api/empleados/${empleadoId}/campos-personalizados`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valores }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Campos personalizados guardados" });
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setGuardando(false);
    }
  };

  const crearCampo = async () => {
    const etiqueta = nuevaEtiqueta.trim();
    if (!etiqueta) {
      toast({ title: "Escribe un nombre para el campo", variant: "destructive" });
      return;
    }
    setCreando(true);
    try {
      const res = await fetch(`/api/empleados/campos-personalizados`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etiqueta, tipo: nuevoTipo }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Campo añadido", description: "Aparecerá en la ficha de todos los empleados." });
      setNuevaEtiqueta("");
      setNuevoTipo("texto");
      setNuevoOpen(false);
      await cargar();
    } catch {
      toast({ title: "Error al añadir el campo", variant: "destructive" });
    } finally {
      setCreando(false);
    }
  };

  const eliminarCampo = async (campo: Campo) => {
    try {
      const res = await fetch(`/api/empleados/campos-personalizados/${campo.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast({ title: "Campo eliminado" });
      await cargar();
    } catch {
      toast({ title: "Error al eliminar el campo", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--primary)]" />
          Campos personalizados
          {!puedeEditar && (
            <span className="text-xs font-normal text-slate-400">(solo lectura)</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {campos.length === 0 ? (
              <p className="text-sm text-slate-400">
                No hay campos personalizados.
                {puedeEditar && " Añade uno para que aparezca en la ficha de todos los empleados."}
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {campos.map((c) => (
                  <div key={c.id}>
                    <div className="flex items-center justify-between gap-2">
                      <Label>{c.etiqueta}</Label>
                      {puedeEditar && (
                        <button
                          type="button"
                          onClick={() => eliminarCampo(c)}
                          title="Eliminar este campo (afecta a todos los empleados)"
                          className="text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <Input
                      className="mt-1"
                      type={TIPO_INPUT[c.tipo] ?? "text"}
                      value={valores[c.id] ?? ""}
                      disabled={!puedeEditar}
                      onChange={(e) =>
                        setValores((prev) => ({ ...prev, [c.id]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            {puedeEditar && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                {nuevoOpen ? (
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                    <div className="flex-1">
                      <Label>Nombre del campo</Label>
                      <Input
                        className="mt-1"
                        autoFocus
                        placeholder="Ej: Talla de uniforme"
                        value={nuevaEtiqueta}
                        onChange={(e) => setNuevaEtiqueta(e.target.value)}
                      />
                    </div>
                    <div className="w-full sm:w-40">
                      <Label>Tipo</Label>
                      <Select value={nuevoTipo} onValueChange={setNuevoTipo}>
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="texto">Texto</SelectItem>
                          <SelectItem value="numero">Número</SelectItem>
                          <SelectItem value="fecha">Fecha</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={crearCampo} disabled={creando}>
                        {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Añadir"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setNuevoOpen(false);
                          setNuevaEtiqueta("");
                        }}
                        disabled={creando}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setNuevoOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" /> Añadir campo personalizado
                  </Button>
                )}
              </div>
            )}

            {puedeEditar && campos.length > 0 && (
              <div className="mt-4 flex justify-end">
                <Button onClick={guardarValores} disabled={guardando}>
                  {guardando ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Guardar campos
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
