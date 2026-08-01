"use client";

/**
 * Ventana de entrega de sobres al responsable que pasa a recogerlos
 * (ticket 6d24af90).
 *
 * El caso real: el responsable no viene cada semana. Cuando aparece por una
 * tienda puede haber dos o tres sobres esperando en el cajón, y hasta ahora
 * había que firmarlos de uno en uno, buscándolos semana por semana en el
 * selector.
 *
 * Son dos pasos, en este orden a propósito:
 *
 *  1. **Qué sobres se lleva.** Todos los pendientes, de todas las semanas, con
 *     su importe y cuánto llevan esperando. Vienen todos marcados: lo normal es
 *     llevárselos todos, y desmarcar es más rápido que ir marcando.
 *  2. **Quién se los lleva, y su PIN.** Quien tiene el dispositivo delante es
 *     la tienda —el ordenador del mostrador o un móvil, según el sitio—, así que
 *     el responsable se elige de la lista y teclea su PIN ahí mismo: esa es la
 *     firma. Solo salen los que tienen PIN puesto — sin PIN no hay forma de
 *     firmar.
 *
 * El PIN se comprueba en el servidor contra el hash de esa persona, y los tres
 * fallos seguidos bloquean la firma un rato. Aquí no se guarda ni se enseña.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, KeyRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface SobrePendiente {
  id: string;
  semana: string;
  semanaTexto: string;
  sede: string;
  importe: number;
  declaradoPor: string | null;
  notas: string | null;
  diasEsperando: number;
}

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

export function DialogoEntregaSobres({
  abierto,
  onCerrar,
  onFirmado,
}: {
  abierto: boolean;
  onCerrar: () => void;
  /** Tras firmar, para que la pantalla de detrás se refresque. */
  onFirmado: () => void;
}) {
  const [cargando, setCargando] = useState(true);
  const [pendientes, setPendientes] = useState<SobrePendiente[]>([]);
  const [autorizados, setAutorizados] = useState<{ id: string; nombre: string }[]>([]);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [paso, setPaso] = useState<"sobres" | "firma">("sobres");
  const [responsable, setResponsable] = useState("");
  const [pin, setPin] = useState("");
  const [firmando, setFirmando] = useState(false);
  const { toast } = useToast();

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/arqueos/pendientes");
      if (!res.ok) return;
      const data = (await res.json()) as {
        pendientes: SobrePendiente[];
        autorizados: { id: string; nombre: string }[];
      };
      setPendientes(data.pendientes ?? []);
      setAutorizados(data.autorizados ?? []);
      // Todos marcados: lo normal es llevárselos todos.
      setElegidos(new Set((data.pendientes ?? []).map((p) => p.id)));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (!abierto) return;
    setPaso("sobres");
    setPin("");
    setResponsable("");
    void cargar();
  }, [abierto, cargar]);

  const alternar = (id: string) =>
    setElegidos((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const seleccionados = pendientes.filter((p) => elegidos.has(p.id));
  const total = Math.round(seleccionados.reduce((n, p) => n + p.importe, 0) * 100) / 100;

  const firmar = async () => {
    if (!responsable) {
      toast({ title: "Falta el responsable", description: "Elige quién se lleva el dinero.", variant: "destructive" });
      return;
    }
    if (!pin.trim()) {
      toast({ title: "Falta el PIN", description: "El responsable tiene que teclear su PIN.", variant: "destructive" });
      return;
    }
    setFirmando(true);
    try {
      const res = await fetch("/api/arqueos/recoger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arqueoIds: [...elegidos],
          recogidoPorId: responsable,
          pin: pin.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "No se pudo firmar", description: data.error ?? "", variant: "destructive" });
        setPin("");
        return;
      }
      toast({
        title: `${data.sobres} sobre${data.sobres === 1 ? "" : "s"} entregado${data.sobres === 1 ? "" : "s"}`,
        description: `${eur(data.total)} — se los lleva ${data.recogidoPor}.`,
      });
      onFirmado();
      onCerrar();
    } catch {
      toast({ title: "Sin conexión", description: "No se ha podido firmar. Revisa la conexión.", variant: "destructive" });
    } finally {
      setFirmando(false);
    }
  };

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {paso === "sobres" ? "Entregar sobres" : "¿Quién se lleva el dinero?"}
          </DialogTitle>
          <DialogDescription>
            {paso === "sobres"
              ? "Marca los sobres que se lleva el responsable. Pueden ser de varias semanas."
              : "Elige al responsable y que teclee su PIN: esa es su firma."}
          </DialogDescription>
        </DialogHeader>

        {cargando ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-[var(--muted)] rounded animate-pulse" />
            ))}
          </div>
        ) : pendientes.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            No hay ningún sobre pendiente de recoger.
          </p>
        ) : paso === "sobres" ? (
          <>
            <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-md border border-[var(--border)]">
              {pendientes.map((p) => (
                <li key={p.id}>
                  <label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-[var(--muted)]">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--primary)]"
                      checked={elegidos.has(p.id)}
                      onChange={() => alternar(p.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium text-[var(--text-dark)]">{p.sede}</span>
                        <span className="text-sm font-bold tabular-nums text-[var(--text-dark)]">
                          {eur(p.importe)}
                        </span>
                      </span>
                      <span className="block text-xs text-[var(--text-muted)]">
                        {p.semanaTexto}
                        {p.declaradoPor ? ` · lo preparó ${p.declaradoPor}` : ""}
                      </span>
                      {/* Un sobre de hace más de dos semanas es dinero parado en
                          un cajón: se dice, sin bloquear nada. */}
                      {p.diasEsperando >= 14 && (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--warning-text)]">
                          <AlertTriangle className="h-3 w-3" />
                          Lleva {p.diasEsperando} días esperando
                        </span>
                      )}
                      {p.notas && (
                        <span className="block text-xs text-[var(--text-muted)] mt-0.5">«{p.notas}»</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-sm text-[var(--text-body)]">
                {seleccionados.length} de {pendientes.length} ·{" "}
                <strong className="tabular-nums text-[var(--text-dark)]">{eur(total)}</strong>
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={onCerrar}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={seleccionados.length === 0}
                  onClick={() => setPaso("firma")}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--text-body)] flex items-center gap-2">
              <Wallet className="h-4 w-4 text-[var(--primary)] shrink-0" />
              <span>
                Se entregan <strong>{seleccionados.length}</strong> sobre
                {seleccionados.length === 1 ? "" : "s"} por un total de{" "}
                <strong className="tabular-nums">{eur(total)}</strong>.
              </span>
            </div>

            <div>
              <Label htmlFor="entrega-responsable">Responsable que se lo lleva</Label>
              <select
                id="entrega-responsable"
                className="mt-1 w-full rounded-md border border-[var(--border)] px-3 py-2 text-base"
                value={responsable}
                onChange={(e) => setResponsable(e.target.value)}
              >
                <option value="">Elige a la persona…</option>
                {autorizados.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </select>
              {autorizados.length === 0 && (
                <p className="text-xs text-[var(--warning-text)] mt-1">
                  Nadie tiene PIN de recogida todavía. Lo pone administración desde
                  «Quién puede recoger efectivo».
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="entrega-pin">Su PIN</Label>
              <Input
                id="entrega-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className="mt-1 tabular-nums"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !firmando) void firmar();
                }}
                placeholder="••••"
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Que lo teclee el responsable en este dispositivo. Queda registrado que este
                dinero se lo llevó él.
              </p>
            </div>

            <div className="flex justify-between gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setPaso("sobres")}>
                Atrás
              </Button>
              <Button size="sm" disabled={firmando || !responsable || !pin} onClick={() => void firmar()}>
                <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                {firmando ? "Firmando…" : "Firmar la entrega"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
