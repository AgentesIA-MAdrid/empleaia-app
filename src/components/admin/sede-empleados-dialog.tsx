"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { useToast } from "@/hooks/use-toast";
import { getLabelRol } from "@/lib/utils";

interface EmpleadoLite {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  rol: "OWNER" | "MANAGER" | "EMPLEADO";
}

export function SedeEmpleadosDialog({
  tienda,
  onClose,
  onSaved,
}: {
  tienda: { id: string; nombre: string } | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [empleados, setEmpleados] = useState<EmpleadoLite[]>([]);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tienda) return;
    setLoading(true);
    setBusqueda("");
    Promise.all([
      fetch("/api/empleados").then((r) => r.json()),
      fetch(`/api/tiendas/${tienda.id}/empleados`).then((r) => r.json()),
    ])
      .then(([emp, mem]) => {
        setEmpleados(emp.empleados ?? []);
        setSeleccionados(new Set<string>(mem.miembros ?? []));
      })
      .catch(() => toast({ title: "Error al cargar empleados", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [tienda, toast]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return empleados;
    return empleados.filter((e) =>
      `${e.nombre} ${e.apellidos} ${e.email}`.toLowerCase().includes(q),
    );
  }, [empleados, busqueda]);

  const toggle = (id: string) =>
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const guardar = async () => {
    if (!tienda) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tiendas/${tienda.id}/empleados`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...seleccionados] }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Error");
      }
      toast({ title: "Empleados de la sede actualizados" });
      onSaved?.();
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
          <DialogTitle>Empleados — {tienda?.nombre}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input
                placeholder="Buscar empleado…"
                className="pl-9"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              {seleccionados.size} asignado{seleccionados.size === 1 ? "" : "s"} a esta sede.
              Un empleado puede pertenecer a varias sedes.
            </p>
            <div className="max-h-[50vh] overflow-y-auto divide-y divide-slate-100 rounded-lg border border-[var(--border)]">
              {filtrados.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--text-muted)]">Sin empleados</p>
              ) : (
                filtrados.map((e) => (
                  <label
                    key={e.id}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--muted)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--primary)]"
                      checked={seleccionados.has(e.id)}
                      onChange={() => toggle(e.id)}
                    />
                    <EmployeeAvatar nombre={e.nombre} apellidos={e.apellidos} seed={e.id} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-dark)] truncate">
                        {e.nombre} {e.apellidos}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        {e.email} · {getLabelRol(e.rol)}
                      </p>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={guardar} disabled={saving || loading}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
