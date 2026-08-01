"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Mail, AlertCircle, CheckCircle2, ArrowLeft, KeyRound } from "lucide-react";
import { EmpleaIALogo } from "@/components/brand/empleaia-logo";

interface Branding {
  logo: string | null;
  appNombre: string;
}

const INPUT_CLASS =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm text-[var(--color-text-dark,#0F172A)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors";

function RecuperarPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Introduce un email válido");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/recuperar-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error al enviar el email");
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al enviar el email");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--success-bg)]">
          <CheckCircle2 className="h-8 w-8 text-[var(--success-text)]" />
        </div>
        <div className="text-center">
          <p className="text-[var(--text-dark)] font-semibold text-lg">Revisa tu correo</p>
          <p className="text-[var(--text-muted)] text-sm mt-1 leading-relaxed">
            Si existe una cuenta asociada a <strong className="text-[var(--text-body)]">{email}</strong>,
            recibirás un email con un enlace para restablecer tu contraseña.
            El enlace caduca en 1 hora.
          </p>
        </div>
        <Link
          href="/login"
          className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-[var(--primary)] hover:text-[var(--primary-dark)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al inicio de sesión
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="flex items-start gap-3 rounded-md border border-[var(--danger-bg)] bg-[var(--danger-bg)] px-3 py-2.5 text-sm text-[var(--danger-text)]">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-[var(--text-body)] mb-1.5">
          Correo electrónico
        </label>
        <div className="relative">
          <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="usuario@empresa.com"
            className={`${INPUT_CLASS} pl-9`}
          />
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Te enviaremos un enlace para crear una nueva contraseña.
        </p>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30 focus-visible:ring-offset-1 disabled:opacity-60"
      >
        <KeyRound className="h-4 w-4" />
        {loading ? "Enviando..." : "Enviar enlace de recuperación"}
      </button>

      <div className="pt-2 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-body)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver al inicio de sesión
        </Link>
      </div>
    </form>
  );
}

export default function RecuperarPasswordPage() {
  const [branding, setBranding] = useState<Branding>({
    logo: null,
    appNombre: "empleaIA",
  });

  useEffect(() => {
    fetch("/api/configuracion/branding")
      .then((r) => r.json())
      .then((d) => setBranding({ logo: d?.logo ?? null, appNombre: d?.appNombre ?? "empleaIA" }))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--muted)]">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-60" />
        <div className="absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-50" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="flex flex-col items-center mb-8">
          {branding.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logo}
              alt={branding.appNombre}
              className="h-12 max-w-[200px] object-contain mb-4"
            />
          ) : (
            <EmpleaIALogo appNombre={branding.appNombre} symbolSize={80} className="mb-4" />
          )}
          <p className="text-sm text-[var(--text-muted)]">Recuperación de contraseña</p>
        </div>

        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-sm">
          <div className="px-6 py-6 sm:px-8 sm:py-8">
            <div className="mb-6 text-center">
              <h1 className="text-xl font-semibold text-[var(--text-dark)]">¿Olvidaste tu contraseña?</h1>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Introduce tu email y te enviaremos un enlace para crear una nueva.
              </p>
            </div>

            <RecuperarPasswordForm />
          </div>
        </div>
      </div>
    </div>
  );
}
