"use client";

import React, { useState, Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle, Shuffle, Copy, Check } from "lucide-react";
import { EmpleaIALogo } from "@/components/brand/empleaia-logo";

interface Branding {
  logo: string | null;
  appNombre: string;
}

/**
 * Entero uniforme en [0, max) con CSPRNG (Web Crypto). Usa rejection
 * sampling para evitar el sesgo modular de `valor % max` cuando 2^32 no
 * es múltiplo de `max`. NUNCA usar Math.random() para generar credenciales:
 * es predecible y no criptográficamente seguro.
 */
function randomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0]!;
  } while (x >= limit);
  return x % max;
}

function generatePassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*()-_=+[]{}|;:,.<>?";
  const all = upper + lower + digits + symbols;

  const required = [
    upper[randomInt(upper.length)],
    lower[randomInt(lower.length)],
    digits[randomInt(digits.length)],
    symbols[randomInt(symbols.length)],
  ];

  const rest = Array.from({ length: 28 }, () => all[randomInt(all.length)]);
  const combined = [...required, ...rest];

  for (let i = combined.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join("");
}

const INPUT_CLASS =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm text-[var(--color-text-dark,#0F172A)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors";

function SetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = () => {
    const pwd = generatePassword();
    setPassword(pwd);
    setConfirm(pwd);
    setGenerated(true);
    setShowPwd(true);
    setError(null);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    if (!generated && password !== confirm) {
      setError("Las contraseñas no coinciden");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setDone(true);
      setTimeout(() => router.replace("/login"), 3000);
    } catch (e: any) {
      setError(e.message || "Error al establecer la contraseña");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-[var(--danger-bg)] bg-[var(--danger-bg)] px-3 py-2.5 text-sm text-[var(--danger-text)]">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>Enlace no válido. Contacta con tu administrador.</span>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--success-bg)]">
          <CheckCircle2 className="h-8 w-8 text-[var(--success-text)]" />
        </div>
        <div className="text-center">
          <p className="text-[var(--text-dark)] font-semibold text-lg">¡Contraseña creada!</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">Redirigiendo al inicio de sesión...</p>
        </div>
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
        <label className="block text-sm font-medium text-[var(--text-body)] mb-1.5">
          Nueva contraseña
        </label>
        <div className="relative">
          <input
            type={showPwd ? "text" : "password"}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setGenerated(false); }}
            required
            minLength={6}
            placeholder="Mínimo 6 caracteres"
            className={`${INPUT_CLASS} pr-10 font-mono`}
          />
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-body)] transition-colors"
          >
            {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {!generated && (
        <div>
          <label className="block text-sm font-medium text-[var(--text-body)] mb-1.5">
            Confirmar contraseña
          </label>
          <input
            type={showPwd ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            placeholder="Repite la contraseña"
            className={`${INPUT_CLASS} font-mono`}
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm font-medium text-[var(--color-text-dark,#0F172A)] transition-colors hover:bg-[var(--bg-subtle,#F8FAFC)]"
        >
          <Shuffle className="h-4 w-4" />
          Generar contraseña
        </button>

        {password && (
          <button
            type="button"
            onClick={handleCopy}
            className={`flex items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
              copied
                ? "border-emerald-300 bg-[var(--success-bg)] text-[var(--success-text)]"
                : "border-[var(--color-border,#E2E8F0)] bg-[var(--card)] text-[var(--color-text-dark,#0F172A)] hover:bg-[var(--bg-subtle,#F8FAFC)]"
            }`}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiada" : "Copiar"}
          </button>
        )}
      </div>

      {generated && (
        <p className="text-xs text-[var(--text-muted)] text-center -mt-1">
          Contraseña generada automáticamente — cópiala antes de continuar
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30 focus-visible:ring-offset-1 disabled:opacity-60"
      >
        <KeyRound className="h-4 w-4" />
        {loading ? "Guardando..." : "Establecer contraseña"}
      </button>
    </form>
  );
}

function SetPasswordPageInner() {
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
          <p className="text-sm text-[var(--text-muted)]">Activa tu cuenta para acceder a la plataforma</p>
        </div>

        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-sm">
          <div className="px-6 py-6 sm:px-8 sm:py-8">
            <div className="mb-6 text-center">
              <h1 className="text-xl font-semibold text-[var(--text-dark)]">Crea tu contraseña</h1>
              <p className="text-sm text-[var(--text-muted)] mt-1">Mínimo 6 caracteres</p>
            </div>

            <Suspense fallback={<div className="text-[var(--text-muted)] text-sm text-center">Cargando...</div>}>
              <SetPasswordForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--muted)]" />}>
      <SetPasswordPageInner />
    </Suspense>
  );
}
