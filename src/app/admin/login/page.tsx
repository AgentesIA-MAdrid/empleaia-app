"use client";

/**
 * /admin/login — login del panel super-admin (control plane).
 * Diseño alineado con el login del tenant: blobs de fondo, logo
 * empleaIA, paleta primaria. La diferencia visible es el badge
 * "Super-admin" en lugar del tagline del tenant.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LogIn, AlertCircle, ShieldCheck } from "lucide-react";
import { EmpleaIALogo } from "@/components/brand/empleaia-logo";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (r.ok) {
        router.push("/admin/dashboard");
        router.refresh();
        return;
      }
      const body = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setError("Credenciales incorrectas");
      } else {
        setError(body?.error ?? `Error ${r.status}`);
      }
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--muted)]">
      {/* Sutiles blobs de color en el fondo */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-60" />
        <div className="absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-50" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Logo + badge super-admin arriba */}
        <div className="flex flex-col items-center mb-8">
          <EmpleaIALogo appNombre="empleaIA" symbolSize={80} className="mb-4" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)]/10 px-3 py-1 text-xs font-semibold text-[var(--primary)]">
            <ShieldCheck className="h-3.5 w-3.5" />
            Super-admin · Panel interno
          </span>
        </div>

        {/* Card formulario */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-sm">
          <div className="px-8 py-8">
            <div className="mb-6 text-center">
              <h1 className="text-xl font-semibold text-[var(--text-dark)]">Iniciar sesión</h1>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Acceso exclusivo al control plane de empleaIA
              </p>
            </div>

            {error && (
              <div className="mb-5 flex items-start gap-3 rounded-md border border-[var(--danger-bg)] bg-[var(--danger-bg)] px-3 py-2.5 text-sm text-[var(--danger-text)] animate-fade-in">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-[var(--color-text-dark,#0F172A)] mb-1.5"
                >
                  Correo electrónico
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="admin@empleaia.es"
                  className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm text-[var(--color-text-dark,#0F172A)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-[var(--color-text-dark,#0F172A)] mb-1.5"
                >
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] pl-3.5 pr-11 py-2 text-sm text-[var(--color-text-dark,#0F172A)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-colors"
                    aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
                    tabIndex={-1}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] active:bg-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30 focus-visible:ring-offset-1 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <LogIn className="h-4 w-4" />
                {loading ? "Entrando…" : "Iniciar sesión"}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
              Solo personal autorizado de empleaIA.
            </p>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
          empleaIA &mdash; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
