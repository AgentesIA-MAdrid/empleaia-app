"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { EstadoDenuncia } from "@/generated/prisma-tenant/client";
import { ESTADO_LABEL, ESTADOS_ORDER } from "@/lib/denuncias/categorias";

interface Props {
  denunciaId: string;
  estado: EstadoDenuncia;
  asignadoUserId: string | null;
  empleados: Array<{ id: string; nombre: string; apellidos: string }>;
}

export function DenunciaActions({ denunciaId, estado, asignadoUserId, empleados }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState("");

  async function patch(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const r = await fetch(`/api/denuncias/${denunciaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted,#94A3B8)]">
        Gestión
      </h3>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-text-body,#475569)]">
          Estado
        </label>
        <select
          value={estado}
          onChange={(e) => {
            const v = e.target.value as EstadoDenuncia;
            if (v === "resuelta") return; // requiere resumen, manejado abajo
            void patch({ estado: v });
          }}
          disabled={pending}
          className="w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)]"
        >
          {ESTADOS_ORDER.map((e) => (
            <option key={e} value={e}>{ESTADO_LABEL[e]}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-text-body,#475569)]">
          Asignado a
        </label>
        <select
          value={asignadoUserId ?? ""}
          onChange={(e) => void patch({ asignadoUserId: e.target.value || null })}
          disabled={pending}
          className="w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)]"
        >
          <option value="">Sin asignar</option>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>{e.nombre} {e.apellidos}</option>
          ))}
        </select>
      </div>

      {estado !== "resuelta" && estado !== "archivada" && (
        <div className="pt-3 border-t border-[var(--color-border,#E2E8F0)] space-y-2">
          <label className="text-xs font-medium text-[var(--color-text-body,#475569)]">
            Resumen de la resolución
          </label>
          <textarea
            value={resumen}
            onChange={(e) => setResumen(e.target.value)}
            placeholder="Conclusiones, medidas adoptadas, comunicación al informante…"
            className="w-full min-h-[80px] rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] resize-y"
          />
          <button
            type="button"
            disabled={pending || resumen.length < 10}
            onClick={() =>
              void patch({ estado: "resuelta", resolucionResumen: resumen })
            }
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--success)] hover:bg-[var(--success-text)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Marcar como resuelta
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-[var(--danger-text)]">{error}</p>
      )}
    </div>
  );
}
