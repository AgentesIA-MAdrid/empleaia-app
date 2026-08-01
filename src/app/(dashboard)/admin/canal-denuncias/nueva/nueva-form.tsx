"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Copy, Check } from "lucide-react";
import {
  CATEGORIAS_ORDER,
  CATEGORIA_LABEL,
} from "@/lib/denuncias/categorias";

const INPUT =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors";

const TEXTAREA =
  "flex w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors min-h-[140px] resize-y";

export function NuevaDenunciaForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [denunciaId, setDenunciaId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [esAnonima, setEsAnonima] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      asunto: fd.get("asunto") as string,
      categoria: fd.get("categoria") as string,
      descripcion: fd.get("descripcion") as string,
      fechaIncidente: fd.get("fechaIncidente")
        ? new Date(fd.get("fechaIncidente") as string).toISOString()
        : undefined,
      esAnonima,
      informanteEmail: esAnonima ? undefined : (fd.get("informanteEmail") as string) || undefined,
      informanteNombre: esAnonima ? undefined : (fd.get("informanteNombre") as string) || undefined,
      informanteTelefono: esAnonima
        ? undefined
        : (fd.get("informanteTelefono") as string) || undefined,
    };
    try {
      const r = await fetch("/api/denuncias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setAccessToken(data.accessToken as string);
      setDenunciaId(data.id as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToken() {
    if (!accessToken) return;
    await navigator.clipboard.writeText(accessToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (accessToken) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-[var(--success-bg)] bg-[var(--success-bg)] p-4">
          <p className="font-semibold text-[var(--success-text)]">
            ✓ Denuncia recibida
          </p>
          <p className="text-sm text-[var(--success-text)] mt-1">
            Tu denuncia se ha registrado correctamente. El comité del canal
            te enviará un acuse de recibo en máximo 7 días naturales.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--warning-bg)] bg-[var(--warning-bg)] p-4">
          <p className="font-semibold text-[var(--warning-text)]">
            Guarda este código de acceso
          </p>
          <p className="text-sm text-[var(--warning-text)] mt-1">
            Si denunciaste de forma anónima, este es tu único acceso al caso
            para consultar el estado o aportar información. <strong>No se mostrará
            de nuevo</strong>.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 rounded bg-[var(--card)] border border-[var(--warning-bg)] px-3 py-2 font-mono text-xs break-all">
              {accessToken}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-[var(--card)] px-3 py-2 text-xs font-medium text-[var(--warning-text)] hover:bg-[var(--warning-bg)]"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.push(`/admin/canal-denuncias/${denunciaId}`)}
          className="w-full rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-4 py-2.5 text-sm font-semibold text-white"
        >
          Ver detalle de la denuncia
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">
          Asunto <span className="text-[var(--danger-text)]">*</span>
        </span>
        <input name="asunto" required minLength={5} maxLength={200} className={INPUT} placeholder="Resumen breve de los hechos" />
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">
          Categoría <span className="text-[var(--danger-text)]">*</span>
        </span>
        <select name="categoria" required className={INPUT}>
          {CATEGORIAS_ORDER.map((c) => (
            <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>
          ))}
        </select>
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">
          Descripción detallada <span className="text-[var(--danger-text)]">*</span>
        </span>
        <textarea
          name="descripcion"
          required
          minLength={20}
          maxLength={5000}
          className={TEXTAREA}
          placeholder="Describe los hechos con el máximo detalle posible: fechas, lugares, personas implicadas, testigos…"
        />
        <span className="text-xs text-[var(--color-text-muted,#94A3B8)]">
          Mínimo 20 caracteres. Máximo 5000.
        </span>
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">
          Fecha del incidente
          <span className="text-[var(--color-text-muted,#94A3B8)] font-normal ml-1">(opcional)</span>
        </span>
        <input type="date" name="fechaIncidente" className={INPUT} />
      </label>

      <div className="rounded-lg bg-[var(--bg-subtle,#F8FAFC)] p-4 space-y-3">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={esAnonima}
            onChange={(e) => setEsAnonima(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <span className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">
              Denunciar de forma anónima
            </span>
            <span className="block text-xs text-[var(--color-text-muted,#94A3B8)] mt-0.5">
              No se guardará tu identidad. Recibirás un código único para consultar el caso.
            </span>
          </div>
        </label>
      </div>

      {!esAnonima && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">
              Tu nombre
            </span>
            <input name="informanteNombre" maxLength={120} className={INPUT} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">Email</span>
            <input type="email" name="informanteEmail" className={INPUT} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">Teléfono</span>
            <input type="tel" name="informanteTelefono" className={INPUT} />
          </label>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--danger-bg)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-sm text-[var(--danger-text)]">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitting ? "Enviando…" : "Enviar denuncia"}
      </button>
    </form>
  );
}
