"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function ComentarioForm({ denunciaId }: { denunciaId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [contenido, setContenido] = useState("");
  const [esInterno, setEsInterno] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (contenido.trim().length === 0) return;
    setPending(true);
    setError(null);
    try {
      const r = await fetch(`/api/denuncias/${denunciaId}/comentarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contenido, esInterno }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setContenido("");
      setEsInterno(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={contenido}
        onChange={(e) => setContenido(e.target.value)}
        placeholder="Escribe un comentario o nota de seguimiento…"
        className="w-full min-h-[80px] rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] resize-y"
      />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-body,#475569)] cursor-pointer">
          <input
            type="checkbox"
            checked={esInterno}
            onChange={(e) => setEsInterno(e.target.checked)}
          />
          Comentario interno (no visible para el informante)
        </label>
        <button
          type="submit"
          disabled={pending || contenido.trim().length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Añadir comentario
        </button>
      </div>
      {error && <p className="text-xs text-[var(--danger-text)]">{error}</p>}
    </form>
  );
}
