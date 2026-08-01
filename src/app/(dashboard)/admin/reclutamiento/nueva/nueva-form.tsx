"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ESTADOS_OFERTA_ORDER, ESTADO_OFERTA_LABEL } from "@/lib/reclutamiento/labels";

const INPUT =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)]";

export function NuevaOfertaForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const min = fd.get("salarioMin") ? parseInt(fd.get("salarioMin") as string, 10) * 100 : undefined;
    const max = fd.get("salarioMax") ? parseInt(fd.get("salarioMax") as string, 10) * 100 : undefined;
    try {
      const r = await fetch("/api/ofertas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: fd.get("titulo"),
          descripcion: fd.get("descripcion"),
          departamento: (fd.get("departamento") as string) || undefined,
          ubicacion: (fd.get("ubicacion") as string) || undefined,
          modalidad: (fd.get("modalidad") as string) || undefined,
          salarioMinCents: min,
          salarioMaxCents: max,
          estado: fd.get("estado") || "borrador",
          fechaCierre: fd.get("fechaCierre")
            ? new Date(fd.get("fechaCierre") as string).toISOString()
            : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      router.push(`/admin/reclutamiento/${data.oferta.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">Título *</span>
        <input name="titulo" required minLength={3} maxLength={200} className={INPUT} placeholder="Ej. Desarrollador/a Backend" />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">Descripción *</span>
        <textarea
          name="descripcion"
          required
          minLength={20}
          maxLength={10000}
          rows={6}
          className="w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] resize-y"
          placeholder="Funciones, requisitos, beneficios…"
        />
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Departamento</span>
          <input name="departamento" maxLength={100} className={INPUT} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Ubicación</span>
          <input name="ubicacion" maxLength={120} className={INPUT} placeholder="Madrid / Barcelona / Remoto" />
        </label>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Modalidad</span>
          <select name="modalidad" className={INPUT}>
            <option value="">—</option>
            <option value="presencial">Presencial</option>
            <option value="remoto">Remoto</option>
            <option value="hibrido">Híbrido</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Salario mín (€)</span>
          <input type="number" name="salarioMin" min={0} step={1000} className={INPUT} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Salario máx (€)</span>
          <input type="number" name="salarioMax" min={0} step={1000} className={INPUT} />
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Estado</span>
          <select name="estado" className={INPUT}>
            {ESTADOS_OFERTA_ORDER.map((e) => (
              <option key={e} value={e}>{ESTADO_OFERTA_LABEL[e]}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Cierra el</span>
          <input type="date" name="fechaCierre" className={INPUT} />
        </label>
      </div>

      {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? "Creando…" : "Crear oferta"}
      </button>
    </form>
  );
}
