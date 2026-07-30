"use client";

/**
 * Arqueos semanales de efectivo.
 *
 * La misma pantalla para la tienda y para administración: quien declara el
 * efectivo apartado y quien lo recoge firmando con su PIN. Lo que cada uno puede
 * hacer llega del servidor (`yo`), no de la ruta.
 *
 * Al lado de lo declarado se muestra siempre lo que suman los cierres de caja de
 * esa semana, para que la diferencia salte en el momento y no en una revisión de
 * fin de mes. Por debajo del umbral del cliente (1 € por defecto) no se marca
 * nada: son redondeos.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { GestionRecogedores } from "@/components/cierre-turno/gestion-recogedores";

interface FilaArqueo {
  arqueoId: string | null;
  tiendaId: string;
  sede: string;
  declarado: number | null;
  segunCierres: number;
  diferencia: number | null;
  descuadre: boolean;
  estado: "sin_declarar" | "pendiente" | "recogido";
  notas: string | null;
  declaradoPor: string | null;
  declaradoEn: string | null;
  recogidoPor: string | null;
  recogidoEn: string | null;
  efectivoRecogido: number | null;
}

interface Respuesta {
  semana: string;
  semanaTexto: string;
  desde: string;
  hasta: string;
  umbral: number;
  yo: { rol: string; puedeRecoger: boolean; tienePin: boolean };
  autorizados: { id: string; nombre: string; conPin: boolean }[];
  filas: FilaArqueo[];
  /** El servidor no ha podido acotar por sede: esta persona no tiene ninguna. */
  sinSede?: boolean;
}

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

/** Semana ISO de hoy, en el formato que pide el input `type="week"`. */
function semanaActual(): string {
  const hoy = new Date();
  const d = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()));
  const diaISO = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - diaISO);
  const anio = d.getUTCFullYear();
  const inicio = new Date(Date.UTC(anio, 0, 1));
  const sem = Math.ceil(((d.getTime() - inicio.getTime()) / 86_400_000 + 1) / 7);
  return `${anio}-W${String(sem).padStart(2, "0")}`;
}

export function PanelArqueos({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  const { toast } = useToast();
  const [semana, setSemana] = useState(semanaActual());
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Sede cuyo formulario de declaración está abierto. */
  const [declarando, setDeclarando] = useState<string | null>(null);
  const [efectivo, setEfectivo] = useState("");
  const [notas, setNotas] = useState("");
  /** Arqueo cuyo formulario de firma está abierto. */
  const [firmando, setFirmando] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [recogido, setRecogido] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/arqueos?semana=${encodeURIComponent(semana)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "No se han podido cargar los arqueos.");
        setDatos(null);
        return;
      }
      setDatos(data as Respuesta);
    } catch {
      setError("Sin conexión con el servidor.");
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, [semana]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const abrirDeclaracion = (f: FilaArqueo) => {
    setDeclarando(f.tiendaId);
    setEfectivo(f.declarado === null ? "" : String(f.declarado));
    setNotas(f.notas ?? "");
  };

  const declarar = async (f: FilaArqueo) => {
    setGuardando(true);
    try {
      const res = await fetch("/api/arqueos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ semana, tiendaId: f.tiendaId, efectivo, notas }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se pudo guardar",
          description: (data as { error?: string }).error ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
        return;
      }
      const r = data as { diferencia: number; descuadre: boolean };
      toast({
        title: "Arqueo registrado",
        description: r.descuadre
          ? `Ojo: hay ${eur(Math.abs(r.diferencia))} de diferencia con los cierres de la semana.`
          : "Cuadra con los cierres de la semana.",
        variant: r.descuadre ? "destructive" : undefined,
      });
      setDeclarando(null);
      await cargar();
    } catch {
      toast({ title: "Sin conexión", description: "No se ha guardado el arqueo.", variant: "destructive" });
    } finally {
      setGuardando(false);
    }
  };

  const firmar = async (f: FilaArqueo) => {
    if (!f.arqueoId) return;
    setGuardando(true);
    try {
      const res = await fetch("/api/arqueos/recoger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arqueoId: f.arqueoId, pin, efectivoRecogido: recogido || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se ha podido firmar",
          description: (data as { error?: string }).error ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Recogida firmada",
        description: "Se ha enviado el resguardo por correo a administración, a la sede y a ti.",
      });
      setFirmando(null);
      setPin("");
      setRecogido("");
      await cargar();
    } catch {
      toast({ title: "Sin conexión", description: "No se ha firmado la recogida.", variant: "destructive" });
    } finally {
      setGuardando(false);
    }
  };

  const esAdmin = datos?.yo.rol === "OWNER";
  const totalDeclarado = (datos?.filas ?? []).reduce((n, f) => n + (f.declarado ?? 0), 0);
  const pendientes = (datos?.filas ?? []).filter((f) => f.estado === "pendiente").length;
  const descuadres = (datos?.filas ?? []).filter((f) => f.descuadre).length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{titulo}</h1>
        <p className="text-slate-500 text-sm mt-1 max-w-2xl">{descripcion}</p>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <Label htmlFor="arqueo-semana">Semana</Label>
              <Input
                id="arqueo-semana"
                type="week"
                className="mt-1 w-48"
                value={semana}
                onChange={(e) => setSemana(e.target.value || semanaActual())}
              />
            </div>
            {datos && (
              <p className="text-sm text-slate-500 pb-2">
                Semana {datos.semana} · {datos.semanaTexto}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        {[
          { label: "Efectivo declarado", valor: eur(totalDeclarado), color: "text-slate-900" },
          {
            label: "Sin recoger",
            valor: String(pendientes),
            color: pendientes ? "text-amber-600" : "text-slate-900",
          },
          {
            label: "Con descuadre",
            valor: String(descuadres),
            color: descuadres ? "text-rose-600" : "text-slate-900",
          },
          {
            label: "Umbral de descuadre",
            valor: datos ? eur(datos.umbral) : "—",
            color: "text-[var(--primary)]",
          },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-slate-500">{k.label}</p>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${k.color}`}>{k.valor}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {cargando ? (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
            ))}
          </CardContent>
        </Card>
      ) : datos?.sinSede ? (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-center py-8 text-slate-500 text-sm max-w-md mx-auto">
              No tienes ninguna sede asignada, así que no hay efectivo que arquear. Pídele a
              administración que te asigne tu punto de venta.
            </p>
          </CardContent>
        </Card>
      ) : (datos?.filas.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-center py-8 text-slate-400 text-sm">
              No hay puntos de venta que arquear.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {datos?.filas.map((f) => (
            <Card key={f.tiendaId}>
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-semibold text-slate-900 flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-[var(--primary)]" /> {f.sede}
                    </p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {f.estado === "sin_declarar"
                        ? "Todavía nadie ha declarado el efectivo de esta semana."
                        : f.estado === "recogido"
                          ? `Recogido por ${f.recogidoPor}${
                              f.efectivoRecogido !== null && f.declarado !== null && f.efectivoRecogido !== f.declarado
                                ? ` · se llevó ${eur(f.efectivoRecogido)} de ${eur(f.declarado)}`
                                : ""
                            }`
                          : `Declarado por ${f.declaradoPor ?? "—"} · pendiente de recoger`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold tabular-nums text-slate-900">
                      {f.declarado === null ? "—" : eur(f.declarado)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Según cierres: <span className="tabular-nums">{eur(f.segunCierres)}</span>
                    </p>
                  </div>
                </div>

                {f.diferencia !== null && (
                  <div
                    className={
                      f.descuadre
                        ? "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2"
                        : "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex items-start gap-2"
                    }
                  >
                    {f.descuadre ? (
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                    )}
                    <span>
                      {f.descuadre
                        ? `Diferencia de ${eur(f.diferencia)} ${
                            f.diferencia > 0 ? "de más" : "de menos"
                          } respecto a los cierres de caja de la semana.`
                        : "Cuadra con los cierres de caja de la semana."}
                    </span>
                  </div>
                )}

                {f.notas && <p className="text-sm text-slate-600">«{f.notas}»</p>}

                {/* Declarar / corregir. Un arqueo recogido ya no se toca. */}
                {f.estado !== "recogido" && (
                  <>
                    {declarando === f.tiendaId ? (
                      <div className="rounded-md border border-slate-200 p-3 space-y-3">
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor={`efectivo-${f.tiendaId}`}>Efectivo apartado</Label>
                            <Input
                              id={`efectivo-${f.tiendaId}`}
                              type="number"
                              step="0.01"
                              min="0"
                              className="mt-1 tabular-nums"
                              value={efectivo}
                              onChange={(e) => setEfectivo(e.target.value)}
                              placeholder="0,00"
                            />
                          </div>
                          <div>
                            <Label htmlFor={`notas-${f.tiendaId}`}>Observaciones (opcional)</Label>
                            <Input
                              id={`notas-${f.tiendaId}`}
                              className="mt-1"
                              value={notas}
                              onChange={(e) => setNotas(e.target.value)}
                              placeholder="Faltan 20 € que dejé de cambio…"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button variant="ghost" size="sm" onClick={() => setDeclarando(null)}>
                            Cancelar
                          </Button>
                          <Button size="sm" disabled={guardando} onClick={() => void declarar(f)}>
                            {guardando ? "Guardando…" : "Guardar arqueo"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => abrirDeclaracion(f)}>
                          {f.estado === "sin_declarar" ? "Declarar efectivo" : "Corregir"}
                        </Button>
                        {/* Firmar la recogida: solo quien está autorizado y con
                            PIN puesto, y solo si ya hay algo declarado. */}
                        {datos?.yo.puedeRecoger && f.estado === "pendiente" && (
                          <Button
                            size="sm"
                            disabled={!datos.yo.tienePin}
                            onClick={() => {
                              setFirmando(f.arqueoId);
                              setPin("");
                              setRecogido(f.declarado === null ? "" : String(f.declarado));
                            }}
                          >
                            <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                            {datos.yo.tienePin ? "Recoger y firmar" : "Sin PIN asignado"}
                          </Button>
                        )}
                      </div>
                    )}

                    {firmando !== null && firmando === f.arqueoId && (
                      <div className="rounded-md border border-slate-200 p-3 space-y-3">
                        <p className="text-sm text-slate-600">
                          Firma la recogida con tu PIN. Queda registrado que este dinero lo has
                          recogido tú, y se envía el resguardo por correo.
                        </p>
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor={`recogido-${f.tiendaId}`}>Efectivo que te llevas</Label>
                            <Input
                              id={`recogido-${f.tiendaId}`}
                              type="number"
                              step="0.01"
                              min="0"
                              className="mt-1 tabular-nums"
                              value={recogido}
                              onChange={(e) => setRecogido(e.target.value)}
                            />
                          </div>
                          <div>
                            <Label htmlFor={`pin-${f.tiendaId}`}>Tu PIN</Label>
                            <Input
                              id={`pin-${f.tiendaId}`}
                              type="password"
                              inputMode="numeric"
                              autoComplete="off"
                              className="mt-1 tabular-nums"
                              value={pin}
                              onChange={(e) => setPin(e.target.value)}
                              placeholder="••••"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button variant="ghost" size="sm" onClick={() => setFirmando(null)}>
                            Cancelar
                          </Button>
                          <Button size="sm" disabled={guardando || !pin} onClick={() => void firmar(f)}>
                            {guardando ? "Firmando…" : "Confirmar recogida"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* A quién esperar: se anuncia sin exponer nada del PIN. */}
      {(datos?.autorizados.length ?? 0) > 0 && (
        <p className="text-sm text-slate-500">
          Pueden recoger efectivo:{" "}
          {datos?.autorizados
            .filter((a) => a.conPin)
            .map((a) => a.nombre)
            .join(", ") || "nadie con PIN asignado todavía"}
          .
        </p>
      )}

      {esAdmin && <GestionRecogedores onCambio={cargar} />}
    </div>
  );
}
