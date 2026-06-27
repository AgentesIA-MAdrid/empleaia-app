"use client";

import { useState } from "react";

export default function CuentaPage() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (pw.length < 8) return setMsg({ ok: false, text: "Mínimo 8 caracteres." });
    if (pw !== pw2) return setMsg({ ok: false, text: "Las contraseñas no coinciden." });
    setBusy(true);
    try {
      const r = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: pw }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setMsg({ ok: false, text: d.error ?? "No se pudo cambiar la contraseña." });
        return;
      }
      setMsg({ ok: true, text: "Contraseña actualizada. Úsala en el próximo inicio de sesión." });
      setPw("");
      setPw2("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Mi cuenta</h1>
      <p className="mb-6 text-sm text-slate-500">Cambia la contraseña de tu acceso al panel super-admin.</p>

      <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div>
          <label className="text-sm font-medium text-slate-700">Nueva contraseña</label>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">Repite la contraseña</label>
          <input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
        </div>
        {msg && (
          <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-[var(--primary)] px-4 py-2.5 font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Guardando…" : "Cambiar contraseña"}
        </button>
      </form>
    </div>
  );
}
