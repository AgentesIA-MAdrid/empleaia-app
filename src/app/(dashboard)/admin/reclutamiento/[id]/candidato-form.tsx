"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

const INPUT =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)]";

export function CandidatoForm({ ofertaId }: { ofertaId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const r = await fetch(`/api/ofertas/${ofertaId}/candidatos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: fd.get("nombre"),
          apellidos: fd.get("apellidos"),
          email: fd.get("email"),
          telefono: (fd.get("telefono") as string) || undefined,
          cvUrl: (fd.get("cvUrl") as string) || undefined,
          linkedinUrl: (fd.get("linkedinUrl") as string) || undefined,
          notas: (fd.get("notas") as string) || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">Nombre</span>
          <input name="nombre" required className={INPUT} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">Apellidos</span>
          <input name="apellidos" required className={INPUT} />
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">Email</span>
          <input type="email" name="email" required className={INPUT} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">Teléfono</span>
          <input type="tel" name="telefono" className={INPUT} />
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">URL del CV</span>
          <input type="url" name="cvUrl" className={INPUT} placeholder="https://…" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium">LinkedIn</span>
          <input type="url" name="linkedinUrl" className={INPUT} placeholder="https://linkedin.com/in/…" />
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className="text-xs font-medium">Notas</span>
        <textarea
          name="notas"
          rows={2}
          maxLength={2000}
          className="w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] resize-y"
        />
      </label>

      {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Añadir candidato
      </button>
    </form>
  );
}
