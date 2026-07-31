"use client";

/**
 * Grupos de objetivos (ticket ff5ab304).
 *
 * Aquí administración monta las agrupaciones sobre las que quiere fijar
 * objetivos además de por persona y por punto de venta: "TMT", "Televenta", una
 * zona… Un grupo se compone de comerciales y/o de puntos de venta, y lo que
 * vende cuenta una sola vez aunque estén dentro los dos (la tienda y su gente).
 *
 * Va en un diálogo desde la propia pantalla de objetivos y no en Configuración
 * porque los grupos solo existen para esto: quien está rellenando la parrilla es
 * quien se da cuenta de que le falta un grupo, y mandarle a otra pantalla es
 * perder el hilo de lo que estaba haciendo.
 *
 * Un grupo con objetivos ya fijados no se borra: se desactiva. Deja de salir en
 * la parrilla y el histórico de los meses cerrados sigue siendo legible (misma
 * regla que el catálogo de ventas).
 */

import { useCallback, useEffect, useState } from "react";
import { Layers, Loader2, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { describeMiembrosGrupo } from "@/lib/cierre-turno/grupos-objetivo";

interface Grupo {
  id: string;
  nombre: string;
  activo: boolean;
  orden: number;
  userIds: string[];
  tiendaIds: string[];
}

interface Comercial {
  id: string;
  nombre: string;
  sede: string | null;
}

interface Sede {
  id: string;
  nombre: string;
}

/** Lista de casillas con la que se eligen los miembros. */
function Elector({
  titulo,
  vacio,
  opciones,
  elegidos,
  onToggle,
}: {
  titulo: string;
  vacio: string;
  opciones: { id: string; nombre: string; detalle?: string | null }[];
  elegidos: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      {opciones.length === 0 ? (
        <p className="text-xs text-slate-400 mt-2">{vacio}</p>
      ) : (
        <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100">
          {opciones.map((o) => (
            <label
              key={o.id}
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={elegidos.has(o.id)}
                onChange={() => onToggle(o.id)}
              />
              <span className="flex-1">
                {o.nombre}
                {o.detalle && (
                  <span className="block text-xs text-slate-400">{o.detalle}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function GruposObjetivoDialog({
  abierto,
  onClose,
}: {
  abierto: boolean;
  /** Se llama al cerrar; el padre recarga la parrilla por si algo cambió. */
  onClose: (huboCambios: boolean) => void;
}) {
  const { toast } = useToast();
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [comerciales, setComerciales] = useState<Comercial[]>([]);
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [huboCambios, setHuboCambios] = useState(false);

  // Formulario: sin `editando` es un alta; con él, la edición de ese grupo.
  const [editando, setEditando] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [userIds, setUserIds] = useState<Set<string>>(new Set());
  const [tiendaIds, setTiendaIds] = useState<Set<string>>(new Set());

  const limpiar = () => {
    setEditando(null);
    setNombre("");
    setUserIds(new Set());
    setTiendaIds(new Set());
  };

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/objetivos-venta/grupos");
      const data = (await res.json().catch(() => ({}))) as {
        grupos?: Grupo[];
        comerciales?: Comercial[];
        sedes?: Sede[];
        error?: string;
      };
      if (!res.ok) {
        toast({
          title: "No se han podido cargar los grupos",
          description: data.error ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
        return;
      }
      setGrupos(data.grupos ?? []);
      setComerciales(data.comerciales ?? []);
      setSedes(data.sedes ?? []);
    } catch {
      toast({ title: "Sin conexión con el servidor.", variant: "destructive" });
    } finally {
      setCargando(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!abierto) return;
    limpiar();
    setHuboCambios(false);
    void cargar();
  }, [abierto, cargar]);

  const alternar = (set: Set<string>, id: string) => {
    const copia = new Set(set);
    if (copia.has(id)) copia.delete(id);
    else copia.add(id);
    return copia;
  };

  const editar = (g: Grupo) => {
    setEditando(g.id);
    setNombre(g.nombre);
    setUserIds(new Set(g.userIds));
    setTiendaIds(new Set(g.tiendaIds));
  };

  /** Crea el grupo nuevo o guarda el que se está editando. */
  const guardar = async () => {
    setGuardando(true);
    try {
      const cuerpo = {
        nombre,
        userIds: [...userIds],
        tiendaIds: [...tiendaIds],
      };
      const res = await fetch(
        editando ? `/api/objetivos-venta/grupos/${encodeURIComponent(editando)}` : "/api/objetivos-venta/grupos",
        {
          method: editando ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpo),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string; descartados?: number };
      if (!res.ok) {
        toast({
          title: "No se ha podido guardar",
          description: data.error ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: editando ? "Grupo guardado" : "Grupo creado",
        description: data.descartados
          ? `${data.descartados} miembro(s) ya no existían y se han dejado fuera.`
          : undefined,
      });
      setHuboCambios(true);
      limpiar();
      await cargar();
    } catch {
      toast({ title: "Sin conexión", description: "No se ha guardado el grupo.", variant: "destructive" });
    } finally {
      setGuardando(false);
    }
  };

  const cambiarActivo = async (g: Grupo) => {
    const res = await fetch(`/api/objetivos-venta/grupos/${encodeURIComponent(g.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !g.activo }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast({ title: "No se ha podido cambiar", description: data.error ?? "", variant: "destructive" });
      return;
    }
    setHuboCambios(true);
    await cargar();
  };

  const borrar = async (g: Grupo) => {
    // Se pregunta antes, como en el catálogo de ventas: borrar un grupo se
    // lleva por delante su composición y no hay forma de deshacerlo.
    if (!window.confirm(`¿Borrar el grupo "${g.nombre}"?`)) return;
    const res = await fetch(`/api/objetivos-venta/grupos/${encodeURIComponent(g.id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "No se ha podido borrar",
        description: data.error ?? "Inténtalo de nuevo.",
        variant: "destructive",
      });
      return;
    }
    setHuboCambios(true);
    if (editando === g.id) limpiar();
    await cargar();
  };

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onClose(huboCambios)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[var(--primary)]" /> Grupos de objetivos
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-slate-400 -mt-2">
          Un grupo es un conjunto de comerciales y/o puntos de venta con objetivo propio (por
          ejemplo, TMT). Lo que venden sus miembros cuenta una sola vez, aunque estén dentro la
          tienda y su gente. Es independiente de los objetivos de cada persona y de cada sede.
        </p>

        {cargando ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Los que ya hay */}
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              {grupos.length === 0 ? (
                <p className="text-sm text-slate-400 px-3 py-6 text-center">
                  Todavía no tienes ningún grupo. Crea el primero aquí abajo.
                </p>
              ) : (
                grupos.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {g.nombre}
                        {!g.activo && (
                          <span className="ml-2 text-xs font-normal text-amber-700">
                            Desactivado
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400">{describeMiembrosGrupo(g)}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => editar(g)} title="Editar">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void cambiarActivo(g)}
                      title={g.activo ? "Desactivar" : "Activar"}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void borrar(g)} title="Borrar">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Alta / edición */}
            <div className="rounded-lg border border-slate-200 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">
                  {editando ? "Editar grupo" : "Nuevo grupo"}
                </p>
                {editando && (
                  <Button variant="ghost" size="sm" onClick={limpiar}>
                    <X className="h-3.5 w-3.5 mr-1.5" /> Cancelar
                  </Button>
                )}
              </div>

              <div>
                <Label htmlFor="grupo-nombre">Nombre</Label>
                <Input
                  id="grupo-nombre"
                  className="mt-1"
                  placeholder="TMT"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Elector
                  titulo="Comerciales"
                  vacio="No hay empleados activos."
                  opciones={comerciales.map((c) => ({ id: c.id, nombre: c.nombre, detalle: c.sede }))}
                  elegidos={userIds}
                  onToggle={(id) => setUserIds((prev) => alternar(prev, id))}
                />
                <Elector
                  titulo="Puntos de venta"
                  vacio="No hay puntos de venta activos."
                  opciones={sedes.map((s) => ({ id: s.id, nombre: s.nombre }))}
                  elegidos={tiendaIds}
                  onToggle={(id) => setTiendaIds((prev) => alternar(prev, id))}
                />
              </div>

              <Button disabled={guardando || nombre.trim().length < 2} onClick={() => void guardar()}>
                {editando ? null : <Plus className="h-4 w-4 mr-2" />}
                {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear grupo"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(huboCambios)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
