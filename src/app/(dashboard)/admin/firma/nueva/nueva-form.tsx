"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

const INPUT =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20";

interface Props {
  documentos: Array<{ id: string; nombre: string }>;
  empleados: Array<{ id: string; nombre: string; apellidos: string; email: string }>;
}

export function NuevaSolicitudForm({ documentos, empleados }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/solicitudes-firma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentoId: fd.get("documentoId"),
          destinatarioId: fd.get("destinatarioId"),
          mensaje: (fd.get("mensaje") as string) || undefined,
          expiraEn: fd.get("expiraEn")
            ? new Date(fd.get("expiraEn") as string).toISOString()
            : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      router.push("/admin/firma");
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
        <span className="text-sm font-medium">Documento</span>
        <select name="documentoId" required className={INPUT}>
          {documentos.map((d) => (
            <option key={d.id} value={d.id}>{d.nombre}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">Destinatario</span>
        <select name="destinatarioId" required className={INPUT}>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>{e.nombre} {e.apellidos} ({e.email})</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">
          Mensaje <span className="text-[var(--text-muted)] font-normal">(opcional)</span>
        </span>
        <textarea
          name="mensaje"
          maxLength={1000}
          rows={3}
          className="w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] resize-y"
        />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">
          Fecha límite <span className="text-[var(--text-muted)] font-normal">(opcional)</span>
        </span>
        <input type="datetime-local" name="expiraEn" className={INPUT} />
      </label>

      {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? "Enviando…" : "Solicitar firma"}
      </button>
    </form>
  );
}
