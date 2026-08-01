"use client";

import { useActionState } from "react";
import { LogIn, AlertCircle, Loader2 } from "lucide-react";

export interface LoginFormState {
  ok: boolean;
  error?: string;
}

interface Props {
  action: (prev: LoginFormState | null, formData: FormData) => Promise<LoginFormState>;
  initialEmail?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Email o contraseña incorrectos.",
  Configuration: "Error de configuración del servidor. Contacta con soporte.",
  AccessDenied: "Acceso denegado.",
  Verification: "El enlace ha expirado o ya se usó.",
};

export function TenantLoginForm({ action, initialEmail = "" }: Props) {
  const [state, formAction, pending] = useActionState<LoginFormState | null, FormData>(
    async (prev, fd) => action(prev, fd),
    null,
  );

  const errorMessage = state?.error
    ? ERROR_MESSAGES[state.error] ?? state.error
    : null;

  return (
    <>
      {errorMessage && (
        <div className="mb-5 flex items-start gap-3 rounded-md border border-[var(--danger-bg)] bg-[var(--danger-bg)] px-3 py-2.5 text-sm text-[var(--danger-text)] animate-fade-in">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form action={formAction} className="space-y-4">
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
            autoComplete="email"
            required
            defaultValue={initialEmail}
            placeholder="usuario@empresa.com"
            className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm text-[var(--color-text-dark,#0F172A)] shadow-[var(--shadow-soft-sm)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:shadow-[var(--shadow-focus-ring)] transition-all duration-150"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-[var(--color-text-dark,#0F172A)] mb-1.5"
          >
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className="flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm text-[var(--color-text-dark,#0F172A)] shadow-[var(--shadow-soft-sm)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:shadow-[var(--shadow-focus-ring)] transition-all duration-150"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-[var(--primary-lighter)] via-[var(--primary)] to-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-primary-glow)] transition-all duration-150 ease-out hover:-translate-y-[1px] active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30 focus-visible:ring-offset-1 disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="h-4 w-4" />
          )}
          {pending ? "Entrando…" : "Iniciar sesión"}
        </button>

        <div className="text-center pt-1">
          <a
            href="/recuperar-password"
            className="text-sm text-[var(--text-muted)] hover:text-[var(--primary)] hover:underline transition-colors"
          >
            ¿Olvidaste tu contraseña?
          </a>
        </div>
      </form>
    </>
  );
}
