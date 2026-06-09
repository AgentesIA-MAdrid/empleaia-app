"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

const INPUT =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20";

export function CompletarPerfilForm({
  userId,
  home,
  nombre,
  initial,
}: {
  userId: string;
  home: string;
  nombre: string;
  initial: { dni: string; telefono: string; fechaNacimiento: string };
}) {
  const [dni, setDni] = useState(initial.dni);
  const [telefono, setTelefono] = useState(initial.telefono);
  const [fechaNacimiento, setFechaNacimiento] = useState(initial.fechaNacimiento);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!dni.trim() || !telefono.trim() || !fechaNacimiento) {
      setError("Todos los campos son obligatorios.");
      return;
    }
    setPending(true);
    try {
      const r = await fetch(`/api/empleados/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dni: dni.trim(),
          telefono: telefono.trim(),
          fechaNacimiento,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      // Recarga completa para que el layout re-evalúe perfilCompletado.
      window.location.href = home;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <main className="w-full max-w-md">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-7 py-8">
          <h1 className="text-xl font-bold text-slate-900">
            Bienvenido/a{nombre ? `, ${nombre}` : ""}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Antes de empezar, completa tus datos personales. Son obligatorios.
          </p>

          <form onSubmit={onSubmit} className="mt-6 grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-slate-700">DNI / NIE</span>
              <input
                className={INPUT}
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                placeholder="12345678A"
                required
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-slate-700">Teléfono</span>
              <input
                type="tel"
                className={INPUT}
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="600 000 000"
                required
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-slate-700">Fecha de nacimiento</span>
              <input
                type="date"
                className={INPUT}
                value={fechaNacimiento}
                onChange={(e) => setFechaNacimiento(e.target.value)}
                required
              />
            </label>

            {error && <p className="text-sm text-red-700">{error}</p>}

            <button
              type="submit"
              disabled={pending}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar y continuar
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
