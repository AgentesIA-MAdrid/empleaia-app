"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmpleadoNav {
  id: string;
  nombre: string;
  apellidos: string;
  email?: string;
  dni?: string;
}

/**
 * Navegación entre fichas de empleado: buscador para saltar a cualquier
 * empleado y botón "Siguiente empleado" que avanza al siguiente del
 * directorio. Consume `/api/empleados` (mismo origen que la lista), por lo
 * que hereda su scoping: oculta anonimizados, respeta la sede del manager y
 * el aislamiento multi-empresa. El orden replica el de la lista: alfabético
 * por nombre completo (locale "es").
 */
export function FichaEmpleadoNav({ currentId }: { currentId: string }) {
  const router = useRouter();
  const [empleados, setEmpleados] = useState<EmpleadoNav[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    let activo = true;
    fetch("/api/empleados")
      .then((res) => (res.ok ? res.json() : { empleados: [] }))
      .then((data) => {
        if (!activo) return;
        const lista: EmpleadoNav[] = (data.empleados || []).slice().sort(
          (a: EmpleadoNav, b: EmpleadoNav) =>
            `${a.nombre} ${a.apellidos}`.localeCompare(
              `${b.nombre} ${b.apellidos}`,
              "es",
            ),
        );
        setEmpleados(lista);
      })
      .catch(() => {});
    return () => {
      activo = false;
    };
  }, []);

  const idx = empleados.findIndex((e) => e.id === currentId);
  const siguiente = idx >= 0 && idx < empleados.length - 1 ? empleados[idx + 1] : null;

  const irA = (id: string) => {
    setOpen(false);
    setQ("");
    router.push(`/admin/empleados/${id}`);
  };

  const filtrados = q
    ? empleados.filter((e) =>
        `${e.nombre} ${e.apellidos} ${e.email || ""} ${e.dni || ""}`
          .toLowerCase()
          .includes(q.toLowerCase()),
      )
    : empleados;

  return (
    <div className="flex items-center gap-2">
      <div className="relative w-56">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-[var(--text-muted)] hover:border-[var(--primary)]/50"
        >
          <span className="flex items-center gap-2 truncate">
            <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            Buscar empleado…
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-50 mt-1 w-72 rounded-md border border-input bg-background shadow-lg">
              <div className="border-b border-[var(--border)] p-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Nombre, email, DNI…"
                    className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  />
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {filtrados.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => irA(e.id)}
                    className={cn(
                      "flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-[var(--muted)]",
                      e.id === currentId && "bg-[var(--muted)]",
                    )}
                  >
                    <span className="truncate">
                      {e.nombre} {e.apellidos}
                    </span>
                    {e.email && (
                      <span className="truncate text-xs text-[var(--text-muted)]">{e.email}</span>
                    )}
                  </button>
                ))}
                {filtrados.length === 0 && (
                  <p className="px-3 py-2 text-sm text-[var(--text-muted)]">Sin resultados</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        disabled={!siguiente}
        onClick={() => siguiente && irA(siguiente.id)}
        title={siguiente ? `Ir a ${siguiente.nombre} ${siguiente.apellidos}` : "No hay más empleados"}
      >
        Siguiente empleado <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
