"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";

export function ComentarioAnonimoForm({ token }: { token: string }) {
  const router = useRouter();
  const [contenido, setContenido] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (contenido.trim().length === 0) return;
    setPending(true);
    setError(null);
    try {
      const r = await fetch(`/api/denuncias/anonima/${token}/comentarios`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contenido }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setContenido("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={contenido}
        onChange={(e) => setContenido(e.target.value)}
        placeholder="Aporta más información o responde al comité…"
        rows={3}
        className="w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] resize-y"
      />
      <div className="flex items-center justify-between">
        {error ? (
          <p className="text-xs text-[var(--danger-text)]">{error}</p>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={pending || contenido.trim().length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar
        </button>
      </div>
    </form>
  );
}
