"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, KeyRound } from "lucide-react";

interface User {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  dni: string | null;
  telefono: string | null;
  fechaNacimiento: string | null;
  foto: string | null;
}

const INPUT =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20";

export function PerfilForm({ user }: { user: User }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [pendingPwd, setPendingPwd] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSavedAt(null);
    const fd = new FormData(e.currentTarget);
    try {
      const r = await fetch(`/api/empleados/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: fd.get("nombre"),
          apellidos: fd.get("apellidos"),
          email: fd.get("email"),
          dni: (fd.get("dni") as string) || undefined,
          telefono: (fd.get("telefono") as string) || undefined,
          fechaNacimiento: (fd.get("fechaNacimiento") as string) || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setSavedAt(Date.now());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setPending(false);
    }
  }

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
      const r = await fetch(`/api/empleados/${user.id}`, {
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
      <form onSubmit={saveProfile} className="grid gap-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Nombre</span>
            <input name="nombre" defaultValue={user.nombre} required className={INPUT} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Apellidos</span>
            <input name="apellidos" defaultValue={user.apellidos} required className={INPUT} />
          </label>
        </div>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <input type="email" name="email" defaultValue={user.email} required className={INPUT} />
        </label>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">DNI / NIE</span>
            <input name="dni" defaultValue={user.dni ?? ""} className={INPUT} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Teléfono</span>
            <input type="tel" name="telefono" defaultValue={user.telefono ?? ""} className={INPUT} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Fecha de nacimiento</span>
            <input type="date" name="fechaNacimiento" defaultValue={user.fechaNacimiento ?? ""} className={INPUT} />
          </label>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}
        {savedAt && (
          <p className="text-sm text-emerald-700">Cambios guardados.</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="self-start inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar cambios
        </button>
      </form>

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
