"use client";

/**
 * /admin/aceptar-invitacion?token=… — página PÚBLICA (fuera de (authed)).
 *
 * El invitado establece nombre + contraseña. POST /api/admin/accept-invite
 * crea/reactiva la cuenta super-admin. En éxito, enlaza al login.
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Eye,
  EyeOff,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { EmpleaIALogo } from "@/components/brand/empleaia-logo";

function AcceptInvitationForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("Falta el token de invitación en el enlace.");
      return;
    }
    if (password.length < 12) {
      setError("La contraseña debe tener al menos 12 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/admin/accept-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name: name.trim(), password }),
      });
      if (r.ok) {
        setDone(true);
        return;
      }
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Error ${r.status}`);
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-60" />
        <div className="absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-50" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="flex flex-col items-center mb-8">
          <EmpleaIALogo appNombre="empleaIA" symbolSize={80} className="mb-4" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)]/10 px-3 py-1 text-xs font-semibold text-[var(--primary)]">
            <ShieldCheck className="h-3.5 w-3.5" />
            Super-admin · Panel interno
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="px-8 py-8">
            {done ? (
              <div className="text-center space-y-4">
                <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-emerald-700" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">
                    Cuenta creada
                  </h1>
                  <p className="text-sm text-slate-500 mt-1">
                    Ya puedes iniciar sesión en el panel.
                  </p>
                </div>
                <Link
                  href="/admin/login"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors"
                >
                  Iniciar sesión
                </Link>
              </div>
            ) : (
              <>
                <div className="mb-6 text-center">
                  <h1 className="text-xl font-semibold text-slate-900">
                    Crea tu cuenta
                  </h1>
                  <p className="text-sm text-slate-500 mt-1">
                    Establece tu nombre y contraseña de acceso
                  </p>
                </div>

                {error && (
                  <div className="mb-5 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 animate-fade-in">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="name"
                      className="block text-sm font-medium text-[var(--color-text-dark,#0F172A)] mb-1.5"
                    >
                      Nombre
                    </label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      autoComplete="name"
                      placeholder="Tu nombre"
                      className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3.5 py-2 text-sm text-[var(--color-text-dark,#0F172A)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="password"
                      className="block text-sm font-medium text-[var(--color-text-dark,#0F172A)] mb-1.5"
                    >
                      Contraseña <span className="text-[var(--color-text-muted,#94A3B8)] font-normal">(mín. 12 caracteres)</span>
                    </label>
                    <div className="relative">
                      <input
                        id="password"
                        name="password"
                        type={showPwd ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        placeholder="••••••••••••"
                        className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white pl-3.5 pr-11 py-2 text-sm text-[var(--color-text-dark,#0F172A)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-colors"
                        aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
                        tabIndex={-1}
                      >
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="confirm"
                      className="block text-sm font-medium text-[var(--color-text-dark,#0F172A)] mb-1.5"
                    >
                      Repetir contraseña
                    </label>
                    <input
                      id="confirm"
                      name="confirm"
                      type={showPwd ? "text" : "password"}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      autoComplete="new-password"
                      placeholder="••••••••••••"
                      className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3.5 py-2 text-sm text-[var(--color-text-dark,#0F172A)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] active:bg-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30 focus-visible:ring-offset-1 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loading ? "Creando cuenta…" : "Crear cuenta"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          empleaIA &mdash; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={null}>
      <AcceptInvitationForm />
    </Suspense>
  );
}
