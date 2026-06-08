"use client";

import { useActionState } from "react";
import { registrarTenantAction, type RegistroResult } from "./actions";

type Plan = { key: string; name: string; description: string | null };

const INPUT_CLASS =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3.5 py-2 text-sm text-[var(--color-text-dark,#0F172A)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20 transition-colors";

export function RegistroForm({ planes }: { planes: Plan[] }) {
  const [state, formAction, pending] = useActionState<
    RegistroResult | null,
    FormData
  >(async (_prev, fd) => registrarTenantAction(_prev, fd), null);

  return (
    <form action={formAction} className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">Nombre de la empresa</span>
        <input
          name="nombre"
          required
          minLength={2}
          maxLength={80}
          className={INPUT_CLASS}
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">Email del administrador</span>
        <input name="email" type="email" required className={INPUT_CLASS} />
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">
          Subdominio <span className="text-[var(--color-text-muted,#94A3B8)] font-normal">(3-31 chars, minúsculas, dígitos, _)</span>
        </span>
        <div className="flex items-stretch gap-1.5">
          <input
            name="slug"
            required
            pattern="^[a-z][a-z0-9_]{2,30}$"
            placeholder="acme"
            className={`${INPUT_CLASS} flex-1`}
          />
          <span className="inline-flex items-center text-sm text-[var(--color-text-muted,#94A3B8)] px-2 whitespace-nowrap">
            .empleaia.es
          </span>
        </div>
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-[var(--color-text-dark,#0F172A)]">Plan</span>
        <select name="planKey" required className={INPUT_CLASS}>
          {planes.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
              {p.description ? ` — ${p.description}` : ""}
            </option>
          ))}
        </select>
      </label>

      {/* Sin pago en el alta: periodo fijado a mensual. Se reactivará
          cuando vuelva Stripe Checkout. */}
      <input type="hidden" name="billingPeriod" value="monthly" />

      {state?.kind === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
          {state.message}
          {state.suggestions && state.suggestions.length > 0 && (
            <div className="mt-2">
              Prueba con: {state.suggestions.join(", ")}
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30 focus-visible:ring-offset-1 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending ? "Creando tu cuenta…" : "Crear cuenta"}
      </button>
    </form>
  );
}
