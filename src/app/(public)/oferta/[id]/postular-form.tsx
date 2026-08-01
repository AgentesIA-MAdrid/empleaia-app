"use client";

import { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";

const INPUT =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)]";

export function PostularForm({ ofertaId }: { ofertaId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const r = await fetch(`/api/ofertas/publica/${ofertaId}/postular`, {
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
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-[var(--success-bg)] bg-[var(--success-bg)] p-5 text-center">
        <CheckCircle2 className="h-8 w-8 mx-auto text-[var(--success-text)]" />
        <p className="mt-2 font-semibold text-[var(--success-text)]">¡Candidatura enviada!</p>
        <p className="mt-1 text-sm text-[var(--success-text)]">
          Hemos recibido tu solicitud. Te contactaremos por email si tu perfil
          encaja en el proceso de selección.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Nombre *</span>
          <input name="nombre" required className={INPUT} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Apellidos *</span>
          <input name="apellidos" required className={INPUT} />
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Email *</span>
          <input type="email" name="email" required className={INPUT} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Teléfono</span>
          <input type="tel" name="telefono" className={INPUT} />
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">URL del CV</span>
          <input
            type="url"
            name="cvUrl"
            placeholder="Drive, Dropbox, web personal…"
            className={INPUT}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">LinkedIn</span>
          <input
            type="url"
            name="linkedinUrl"
            placeholder="https://linkedin.com/in/…"
            className={INPUT}
          />
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">¿Por qué te interesa esta oferta?</span>
        <textarea
          name="notas"
          rows={3}
          maxLength={2000}
          className="w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] resize-y"
        />
      </label>

      {error && (
        <p className="text-sm text-[var(--danger-text)]">{error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? "Enviando…" : "Enviar candidatura"}
      </button>
      <p className="text-xs text-[var(--text-muted)] text-center">
        Al enviar aceptas que tratemos tus datos para el proceso de selección.
      </p>
    </form>
  );
}
