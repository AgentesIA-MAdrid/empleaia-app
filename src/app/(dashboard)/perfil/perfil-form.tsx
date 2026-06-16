"use client";

import { useState } from "react";
import { Loader2, KeyRound } from "lucide-react";
import { EmpleadoDatosForm, type EmpleadoDatos } from "@/components/empleados/empleado-datos-form";

const INPUT =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20";

export function PerfilForm({ empleado }: { empleado: EmpleadoDatos }) {
  const [pendingPwd, setPendingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);

  async function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPendingPwd(true);
    setPwdMsg(null);
    const fd = new FormData(e.currentTarget);
    const password = fd.get("password") as string;
    const confirm = fd.get("confirm") as string;
    if (!password || password.length < 8) {
      setPwdMsg("La contraseña debe tener al menos 8 caracteres.");
      setPendingPwd(false);
      return;
    }
    if (password !== confirm) {
      setPwdMsg("Las contraseñas no coinciden.");
      setPendingPwd(false);
      return;
    }
    try {
      const r = await fetch(`/api/empleados/${empleado.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setPwdMsg("Contraseña actualizada.");
      (e.target as HTMLFormElement).reset();
    } catch (e) {
      setPwdMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setPendingPwd(false);
    }
  }

  return (
    <div className="space-y-8">
      <EmpleadoDatosForm empleado={empleado} modo="self" />

      <div className="border-t pt-6">
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Cambiar contraseña
        </h2>
        <form onSubmit={changePassword} className="grid gap-3 sm:grid-cols-2 max-w-md">
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Nueva contraseña</span>
            <input type="password" name="password" required minLength={8} className={INPUT} />
          </label>
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Confirmar</span>
            <input type="password" name="confirm" required minLength={8} className={INPUT} />
          </label>
          {pwdMsg && (
            <p
              className={`sm:col-span-2 text-sm ${pwdMsg.includes("actualizada") ? "text-emerald-700" : "text-red-700"}`}
            >
              {pwdMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={pendingPwd}
            className="sm:col-span-2 self-start inline-flex items-center gap-2 rounded-lg border bg-white hover:bg-slate-50 px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {pendingPwd && <Loader2 className="h-4 w-4 animate-spin" />}
            Actualizar contraseña
          </button>
        </form>
      </div>
    </div>
  );
}
