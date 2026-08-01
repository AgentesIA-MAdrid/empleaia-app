"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, ScanFace } from "lucide-react";
import { FaceCapture } from "@/components/face/face-capture";

interface Props {
  mode: "enroll" | "reset";
  userId: string;
}

export function FaceIdManager({ mode, userId }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "consent" | "capturing" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [consentimiento, setConsentimiento] = useState(false);
  const [pending, setPending] = useState(false);

  async function uploadEmbedding(embedding: number[]) {
    setPending(true);
    setError(null);
    try {
      const r = await fetch("/api/face/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embedding, consentimiento: true }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setPhase("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setPhase("error");
    } finally {
      setPending(false);
    }
  }

  async function reset() {
    if (!confirm("¿Eliminar tu rostro registrado? Tendrás que volver a registrarlo si lo quieres usar.")) return;
    setPending(true);
    try {
      const r = await fetch(`/api/face/template/${userId}`, { method: "DELETE" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setPending(false);
    }
  }

  if (mode === "reset") {
    return (
      <button
        type="button"
        onClick={reset}
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--danger-text)] hover:text-[var(--danger-text)] disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        Eliminar mi Face ID
      </button>
    );
  }

  if (phase === "idle") {
    return (
      <div className="rounded-lg border bg-[var(--card)] p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center">
            <ScanFace className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div>
            <h3 className="font-semibold text-[var(--color-text-dark,#0F172A)]">
              Registrar mi rostro
            </h3>
            <p className="text-sm text-[var(--text-body)] mt-1">
              Te pediremos acceso a la cámara durante un momento. Asegúrate de
              estar bien iluminado y mirar de frente.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPhase("consent")}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-5 py-3 text-sm font-semibold text-white"
        >
          <ScanFace className="h-4 w-4" />
          Empezar registro
        </button>
      </div>
    );
  }

  if (phase === "consent") {
    return (
      <div className="rounded-lg border bg-[var(--card)] p-6 space-y-4">
        <h3 className="font-semibold text-[var(--color-text-dark,#0F172A)]">
          Consentimiento para tratamiento de dato biométrico
        </h3>
        <p className="text-sm text-[var(--text-body)] leading-relaxed">
          Al continuar, autorizas a tu empresa a almacenar un vector matemático
          (no una foto) generado a partir de la geometría de tu rostro, con la
          única finalidad de verificar tu identidad cuando fiches. El dato se
          guarda cifrado con AES-256-GCM y puedes solicitar su eliminación en
          cualquier momento. Esta autorización cumple los requisitos del
          art. 9 del Reglamento (UE) 2016/679 (RGPD) sobre datos especiales.
        </p>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={consentimiento}
            onChange={(e) => setConsentimiento(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm">
            <strong>Acepto</strong> el tratamiento de mi dato biométrico para
            verificación de identidad en fichajes.
          </span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPhase("idle")}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-[var(--muted)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!consentimiento}
            onClick={() => setPhase("capturing")}
            className="flex-1 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Acepto y continuar
          </button>
        </div>
      </div>
    );
  }

  if (phase === "capturing" || phase === "uploading") {
    return (
      <div className="rounded-lg border bg-[var(--card)] p-6">
        <FaceCapture
          cta="Capturar mi rostro"
          pending={pending}
          onCapture={(embedding) => {
            setPhase("uploading");
            void uploadEmbedding(embedding);
          }}
        />
        {error && (
          <div className="mt-3 rounded-md border border-[var(--danger-bg)] bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger-text)]">
            {error}
          </div>
        )}
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="rounded-lg border border-[var(--success-bg)] bg-[var(--success-bg)] p-6 text-center">
        <ScanFace className="h-10 w-10 mx-auto text-[var(--success-text)]" />
        <p className="mt-2 font-semibold text-[var(--success-text)]">
          ¡Tu rostro está registrado!
        </p>
        <p className="mt-1 text-sm text-[var(--success-text)]">
          Ahora puedes usar Face ID al fichar.
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="rounded-lg border border-[var(--danger-bg)] bg-[var(--danger-bg)] p-6 space-y-3">
        <p className="font-semibold text-[var(--danger-text)]">No se pudo registrar</p>
        <p className="text-sm text-[var(--danger-text)]">{error}</p>
        <button
          type="button"
          onClick={() => {
            setPhase("idle");
            setError(null);
          }}
          className="rounded-lg bg-[var(--danger)] hover:bg-[var(--danger-text)] px-4 py-2 text-sm font-medium text-white"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return null;
}
