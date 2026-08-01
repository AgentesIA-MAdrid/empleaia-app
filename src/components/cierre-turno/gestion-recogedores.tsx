"use client";

/**
 * Quién puede recoger efectivo y con qué PIN (solo administración).
 *
 * El rol no basta a propósito: un coordinador puede no recoger caja nunca y un
 * administrador puede no pasar jamás por la tienda. Lo decide una persona.
 *
 * El PIN se envía una vez y se guarda en bcrypt; nunca se puede volver a leer.
 * Si alguien lo olvida, administración le pone uno nuevo — no hay "ver PIN".
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { KeyRound, LockOpen, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface Persona {
  id: string;
  nombre: string;
  rol: string;
  sede: string | null;
  autorizado: boolean;
  tienePin: boolean;
  bloqueado: boolean;
}

export function GestionRecogedores({ onCambio }: { onCambio?: () => void }) {
  const { toast } = useToast();
  const [abierto, setAbierto] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [cargando, setCargando] = useState(false);
  const [pinDe, setPinDe] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/arqueos/pin");
      if (!res.ok) return;
      const data = (await res.json()) as { usuarios: Persona[] };
      setPersonas(data.usuarios ?? []);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (abierto) void cargar();
  }, [abierto, cargar]);

  const refrescar = async () => {
    await cargar();
    onCambio?.();
  };

  const cambiarAutorizacion = async (p: Persona, autorizado: boolean) => {
    const res = await fetch("/api/arqueos/pin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: p.id, autorizado }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({
        title: "No se pudo cambiar",
        description: (data as { error?: string }).error ?? "",
        variant: "destructive",
      });
      return;
    }
    if ((data as { avisoSinPin?: boolean }).avisoSinPin) {
      toast({
        title: "Falta el PIN",
        description: `${p.nombre} no podrá firmar hasta que le asignes un PIN.`,
      });
    }
    await refrescar();
  };

  const desbloquear = async (p: Persona) => {
    const res = await fetch("/api/arqueos/pin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: p.id, desbloquear: true }),
    });
    if (!res.ok) {
      toast({ title: "No se pudo desbloquear", variant: "destructive" });
      return;
    }
    toast({ title: "Desbloqueado", description: `${p.nombre} ya puede volver a intentarlo.` });
    await refrescar();
  };

  const guardarPin = async (p: Persona) => {
    setGuardando(true);
    try {
      const res = await fetch("/api/arqueos/pin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: p.id, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se pudo guardar el PIN",
          description: (data as { error?: string }).error ?? "",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "PIN asignado",
        description: `Dile a ${p.nombre} su PIN: no vas a poder volver a verlo.`,
      });
      setPinDe(null);
      setPin("");
      await refrescar();
    } finally {
      setGuardando(false);
    }
  };

  const quitarPin = async (p: Persona) => {
    const res = await fetch(`/api/arqueos/pin?userId=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "No se pudo quitar el PIN", variant: "destructive" });
      return;
    }
    toast({ title: "PIN retirado", description: `${p.nombre} ya no puede firmar recogidas.` });
    await refrescar();
  };

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[var(--text-dark)] flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--primary)]" /> Quién puede recoger efectivo
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xl">
              Autoriza a quien vaya a recoger el dinero de las tiendas y dale un PIN. El PIN se
              guarda cifrado: si se le olvida, le pones otro.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAbierto((a) => !a)}>
            {abierto ? "Cerrar" : "Gestionar"}
          </Button>
        </div>

        {abierto && (
          <div className="mt-4">
            {cargando ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-9 bg-[var(--muted)] rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto -mx-6">
                <table className="w-full">
                  <thead className="bg-[var(--muted)] border-y border-[var(--border)]">
                    <tr>
                      {["Persona", "Sede", "Autorizado", "PIN", ""].map((h) => (
                        <th
                          key={h}
                          className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] px-4 py-2.5"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {personas.map((p) => (
                      <Fragment key={p.id}>
                      <tr className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-2 text-sm font-medium text-[var(--text-dark)]">
                          {p.nombre}
                          <span className="text-[var(--text-muted)] text-xs ml-2">{p.rol}</span>
                        </td>
                        <td className="px-4 py-2 text-sm text-[var(--text-muted)]">{p.sede ?? "—"}</td>
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            aria-pressed={p.autorizado}
                            aria-label={`Autorizar a ${p.nombre}`}
                            onClick={() => void cambiarAutorizacion(p, !p.autorizado)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                              p.autorizado ? "bg-[var(--primary)]" : "bg-slate-200"
                            }`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--card)] transition-transform ${
                                p.autorizado ? "translate-x-5" : "translate-x-1"
                              }`}
                            />
                          </button>
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {p.tienePin ? (
                            p.bloqueado ? (
                              <span className="text-[var(--warning-text)]">Bloqueado</span>
                            ) : (
                              <span className="text-[var(--success-text)]">Asignado</span>
                            )
                          ) : (
                            <span className="text-[var(--text-muted)]">Sin PIN</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {p.bloqueado && (
                            <Button variant="ghost" size="sm" onClick={() => void desbloquear(p)}>
                              <LockOpen className="h-3.5 w-3.5 mr-1.5" /> Desbloquear
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setPinDe(p.id);
                              setPin("");
                            }}
                          >
                            <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                            {p.tienePin ? "Cambiar PIN" : "Poner PIN"}
                          </Button>
                          {p.tienePin && (
                            <Button variant="ghost" size="sm" onClick={() => void quitarPin(p)}>
                              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Quitar
                            </Button>
                          )}
                        </td>
                      </tr>

                      {/* El campo del PIN va PEGADO a la persona, no al final de
                          la tabla: con 36 filas, quien pulsaba "Poner PIN" en la
                          segunda no veía aparecer nada y daba el botón por roto. */}
                      {pinDe === p.id && (
                        <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="max-w-md space-y-3">
                              <div>
                                <Label htmlFor={`nuevo-pin-${p.id}`}>PIN para {p.nombre}</Label>
                                <Input
                                  id={`nuevo-pin-${p.id}`}
                                  type="password"
                                  inputMode="numeric"
                                  autoComplete="new-password"
                                  autoFocus
                                  className="mt-1 tabular-nums"
                                  value={pin}
                                  onChange={(e) => setPin(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && pin && !guardando) void guardarPin(p);
                                    if (e.key === "Escape") setPinDe(null);
                                  }}
                                  placeholder="Entre 4 y 8 dígitos"
                                />
                                <p className="text-xs text-[var(--text-muted)] mt-1">
                                  Nada de 1234 ni 0000. No podrás volver a verlo: apúntalo o
                                  díselo ahora.
                                </p>
                              </div>
                              <div className="flex gap-2 justify-end">
                                <Button variant="ghost" size="sm" onClick={() => setPinDe(null)}>
                                  Cancelar
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={guardando || !pin}
                                  onClick={() => void guardarPin(p)}
                                >
                                  {guardando ? "Guardando…" : "Guardar PIN"}
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        )}
      </CardContent>
    </Card>
  );
}
