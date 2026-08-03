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
import { AlertTriangle, CheckCircle2, HelpCircle, KeyRound, Pencil, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { GestionRecogedores } from "@/components/cierre-turno/gestion-recogedores";
import { DialogoEntregaSobres } from "@/components/cierre-turno/dialogo-entrega-sobres";

interface FilaArqueo {
  arqueoId: string | null;
  tiendaId: string;
  sede: string;
  declarado: number | null;
  segunCierres: number;
  /** De dónde arranca la caja: lo que quedó del arqueo anterior (o la carga inicial). */
  arranque: { fecha: string; importe: number | null; incidencia: string | null } | null;
  cobradoDesdeArranque: number;
  /** Lo que debería haber acumulado en el cajón, sin el fondo de cambio. */
  esperado: number | null;
  /** El mismo cálculo con los saldos de hoy (puede diferir del congelado). */
  esperadoEnVivo: number | null;
  esperadoDesfasado: boolean;
  sinSaldoMotivo: "sin_arranque" | "arranque_en_incidencia" | null;
  diferencia: number | null;
  descuadre: boolean;
  estado: "sin_declarar" | "pendiente" | "recogido";
  notas: string | null;
  declaradoPor: string | null;
  declaradoEn: string | null;
  recogidoPor: string | null;
  recogidoEn: string | null;
  efectivoRecogido: number | null;
  /** Correcciones de administración, la más reciente primero. */
  correcciones: {
    id: string;
    declaradoAntes: number;
    declaradoDespues: number;
    recogidoAntes: number | null;
    recogidoDespues: number | null;
    motivo: string;
    cuando: string;
    quien: string;
  }[];
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
  /** Semanas que tienen arqueos declarados, la más reciente primero. */
  semanasConArqueos?: { semana: string; texto: string; arqueos: number }[];
  /** El servidor no ha podido acotar por sede: esta persona no tiene ninguna. */
  sinSede?: boolean;
  /** Con `sinSede`: las tiendas entre las que elegir, y la que se le propone. */
  sedes?: { id: string; nombre: string }[];
  sugerida?: { sedeId: string | null; motivo: "ubicacion" | "turno" | "ficha" | "ninguna" };
}

/** Por qué se le propone esa tienda. Se lo decimos: leerlo cambia la respuesta. */
const PORQUE_SEDE: Record<string, string> = {
  ubicacion: "Es la tienda donde has fichado hoy.",
  turno: "Es la tienda de tu turno de hoy en el cuadrante.",
  ficha: "Es tu tienda habitual.",
  ninguna: "No sabemos dónde estás hoy: dínoslo tú.",
};

const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

/** "2026-07-31" → "31 jul". La fecha de dónde viene la caja, sin ruido. */
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return iso;
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(a, m - 1, d)))
    .replace(".", "");
}

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
  /** Sin sede propia: la tienda que dice que está cubriendo hoy (ticket 8c05f3e1). */
  /**
   * Corrección de un arqueo ya firmado (ticket 5a71fe28). Va aparte del
   * formulario de declarar porque pide algo que ese no pide: el motivo, que aquí
   * es obligatorio y queda registrado con nombre y fecha.
   */
  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);
  const [corDeclarado, setCorDeclarado] = useState("");
  const [corRecogido, setCorRecogido] = useState("");
  const [corMotivo, setCorMotivo] = useState("");
  const [corRecalcular, setCorRecalcular] = useState(false);

  const [sedeElegida, setSedeElegida] = useState("");
  const [confirmandoSede, setConfirmandoSede] = useState(false);
  /** Ventana de entrega: el responsable se lleva varios sobres de una vez. */
  const [entregando, setEntregando] = useState(false);
  const [sobresPendientes, setSobresPendientes] = useState<number | null>(null);

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

  /**
   * Deja fijado el centro de trabajo del día y recarga. Se guarda en el cierre
   * de hoy, que es de donde lo lee todo lo demás.
   */
  const confirmarSede = async (tiendaId: string) => {
    if (!tiendaId) return;
    setConfirmandoSede(true);
    try {
      const res = await fetch("/api/cierre-turno/sede", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiendaId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "No se pudo guardar", description: data.error ?? "", variant: "destructive" });
        return;
      }
      await cargar();
    } catch {
      toast({ title: "Sin conexión", description: "Revisa la conexión.", variant: "destructive" });
    } finally {
      setConfirmandoSede(false);
    }
  };

  /** Cuántos sobres esperan, de TODAS las semanas: es lo que justifica el botón. */
  const contarPendientes = useCallback(async () => {
    try {
      const res = await fetch("/api/arqueos/pendientes");
      if (!res.ok) return;
      const data = (await res.json()) as { pendientes: unknown[] };
      setSobresPendientes(data.pendientes?.length ?? 0);
    } catch {
      /* sin conexión: el botón simplemente no se pinta */
    }
  }, []);

  useEffect(() => {
    void contarPendientes();
  }, [contarPendientes]);

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

  /** Corrige los importes de un arqueo firmado, dejando constancia de por qué. */
  const corregir = async (f: FilaArqueo) => {
    if (!f.arqueoId) return;
    setGuardando(true);
    try {
      const res = await fetch("/api/arqueos/corregir", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arqueoId: f.arqueoId,
          efectivoDeclarado: corDeclarado,
          // Solo se manda si el arqueo está firmado: si no, el servidor lo rechaza.
          ...(f.estado === "recogido" ? { efectivoRecogido: corRecogido } : {}),
          motivo: corMotivo,
          recalcularEsperado: corRecalcular,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se ha corregido",
          description: (data as { error?: string }).error ?? "",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Arqueo corregido",
        description: `${f.sede}: ${eur(Number((data as { declarado: number }).declarado))}. Queda registrado quién lo ha cambiado y por qué.`,
      });
      setCorrigiendo(null);
      setCorMotivo("");
      setCorRecalcular(false);
      await cargar();
    } catch {
      toast({ title: "Sin conexión", description: "No se ha corregido nada.", variant: "destructive" });
    } finally {
      setGuardando(false);
    }
  };

  const abrirCorreccion = (f: FilaArqueo) => {
    setCorrigiendo(f.arqueoId);
    setCorDeclarado(f.declarado === null ? "" : String(f.declarado));
    setCorRecogido(f.efectivoRecogido === null ? "" : String(f.efectivoRecogido));
    setCorMotivo("");
    // Si el acumulado con el que se declaró ya no es el que sale hoy, lo normal
    // es querer ponerlo al día: viene marcado.
    setCorRecalcular(f.esperadoDesfasado);
  };

  const esAdmin = datos?.yo.rol === "OWNER";
  const totalDeclarado = (datos?.filas ?? []).reduce((n, f) => n + (f.declarado ?? 0), 0);
  const pendientes = (datos?.filas ?? []).filter((f) => f.estado === "pendiente").length;
  const descuadres = (datos?.filas ?? []).filter((f) => f.descuadre).length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-dark)]">{titulo}</h1>
        <p className="text-[var(--text-muted)] text-sm mt-1 max-w-2xl">{descripcion}</p>
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
              <p className="text-sm text-[var(--text-muted)] pb-2">
                Semana {datos.semana} · {datos.semanaTexto}
              </p>
            )}
            {/* La entrega no va por semana: el responsable se lleva lo que haya
                acumulado, sea de la semana que sea (ticket 6d24af90). */}
            {sobresPendientes !== null && sobresPendientes > 0 && (
              <div className="ml-auto pb-1">
                <Button onClick={() => setEntregando(true)}>
                  <Wallet className="h-4 w-4 mr-1.5" />
                  Entregar sobres ({sobresPendientes})
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* El arqueo se hace el último día de la semana, así que al día siguiente
          esta pantalla abre en una semana vacía y parece que no hay nada. Se
          dice dónde están y se va con un clic (ticket 5a71fe28). */}
      {!cargando &&
        (datos?.filas ?? []).every((f) => f.estado === "sin_declarar") &&
        (datos?.semanasConArqueos ?? []).length > 0 && (
          <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5 text-sm text-[var(--text-body)] flex flex-wrap items-center gap-2">
            <HelpCircle className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            <span>Esta semana todavía no hay arqueos. Los últimos son de:</span>
            {(datos?.semanasConArqueos ?? [])
              .filter((w) => w.semana !== semana)
              .slice(0, 3)
              .map((w) => (
                <button
                  key={w.semana}
                  type="button"
                  onClick={() => setSemana(w.semana)}
                  className="underline underline-offset-2 font-medium text-[var(--primary)]"
                >
                  {w.texto} ({w.arqueos})
                </button>
              ))}
          </div>
        )}

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        {[
          { label: "Efectivo declarado", valor: eur(totalDeclarado), color: "text-[var(--text-dark)]" },
          {
            label: "Sin recoger",
            valor: String(pendientes),
            color: pendientes ? "text-[var(--warning-text)]" : "text-[var(--text-dark)]",
          },
          {
            label: "Con descuadre",
            valor: String(descuadres),
            color: descuadres ? "text-rose-600" : "text-[var(--text-dark)]",
          },
          {
            label: "Umbral de descuadre",
            valor: datos ? eur(datos.umbral) : "—",
            color: "text-[var(--primary)]",
          },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-[var(--text-muted)]">{k.label}</p>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${k.color}`}>{k.valor}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {cargando ? (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-12 bg-[var(--muted)] rounded animate-pulse" />
            ))}
          </CardContent>
        </Card>
      ) : datos?.sinSede ? (
        /* Sin sede en la ficha y sin centro de trabajo confirmado hoy: en vez de
           dejarlo fuera, se le pregunta dónde está. Es el mismo desplegable del
           cierre de turno y se guarda en el mismo sitio (ticket 8c05f3e1): un
           correturnos también tiene que poder arquear la caja que ha llevado. */
        <Card className="mx-auto max-w-md">
          <CardContent className="p-6 text-center space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-dark)]">
                Confirma tu centro de trabajo de hoy
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {PORQUE_SEDE[datos.sugerida?.motivo ?? "ninguna"]}
              </p>
            </div>
            <div className="text-left">
              <Label htmlFor="arqueo-sede">Tienda</Label>
              <select
                id="arqueo-sede"
                className="mt-1 w-full rounded-md border border-[var(--border)] px-3 py-2 text-base"
                value={sedeElegida || (datos.sugerida?.sedeId ?? "")}
                onChange={(e) => setSedeElegida(e.target.value)}
              >
                <option value="">Elige tu tienda…</option>
                {(datos.sedes ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </div>
            <Button
              className="w-full"
              disabled={confirmandoSede || !(sedeElegida || datos.sugerida?.sedeId)}
              onClick={() => void confirmarSede(sedeElegida || (datos.sugerida?.sedeId ?? ""))}
            >
              {confirmandoSede ? "Guardando…" : "Confirmar y ver la caja"}
            </Button>
            <p className="text-xs text-[var(--text-muted)]">
              Es la misma tienda que confirmas al cerrar tu turno: solo hace falta decirlo
              una vez al día.
            </p>
          </CardContent>
        </Card>
      ) : (datos?.filas.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-center py-8 text-[var(--text-muted)] text-sm">
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
                    <p className="font-semibold text-[var(--text-dark)] flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-[var(--primary)]" /> {f.sede}
                    </p>
                    <p className="text-sm text-[var(--text-muted)] mt-0.5">
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
                    <p className="text-2xl font-bold tabular-nums text-[var(--text-dark)]">
                      {f.declarado === null ? "—" : eur(f.declarado)}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {f.esperado === null ? (
                        "Sin acumulado calculable"
                      ) : (
                        <>
                          Debería haber: <span className="tabular-nums">{eur(f.esperado)}</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>

                {/* La cuenta entera, que es lo que la tienda tiene delante el
                    último día al preparar el sobre: de dónde venía la caja, lo que
                    ha entrado y lo que debería haber. El fondo de cambio no
                    aparece porque no se arquea. */}
                {f.esperado !== null ? (
                  <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--text-body)] flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>
                      Venía de{" "}
                      <span className="tabular-nums font-medium text-[var(--text-dark)]">
                        {eur(f.arranque?.importe ?? 0)}
                      </span>
                      {f.arranque && (
                        <span className="text-[var(--text-muted)]"> ({fechaCorta(f.arranque.fecha)})</span>
                      )}
                    </span>
                    <span className="text-[var(--text-muted)]">+</span>
                    <span>
                      cobrado{" "}
                      <span className="tabular-nums font-medium text-[var(--text-dark)]">
                        {eur(f.cobradoDesdeArranque)}
                      </span>
                    </span>
                    <span className="text-[var(--text-muted)]">=</span>
                    <span className="font-semibold text-[var(--text-dark)]">
                      acumulado{" "}
                      <span className="tabular-nums">{eur(f.esperadoEnVivo ?? f.esperado)}</span>
                    </span>
                  </div>
                ) : (
                  <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--text-body)]">
                    {f.sinSaldoMotivo === "arranque_en_incidencia" ? (
                      <>
                        La caja de esta sede quedó pendiente de aclarar
                        {f.arranque && ` el ${fechaCorta(f.arranque.fecha)}`}, así que no se puede
                        decir cuánto debería haber acumulado. Lleva{" "}
                        <span className="tabular-nums">{eur(f.cobradoDesdeArranque)}</span> cobrados
                        desde entonces.
                      </>
                    ) : (
                      <>
                        Esta sede no tiene punto de partida registrado, así que no se puede decir
                        cuánto debería haber acumulado. Lleva{" "}
                        <span className="tabular-nums">{eur(f.segunCierres)}</span> cobrados esta
                        semana.
                      </>
                    )}
                  </div>
                )}

                {f.diferencia !== null && (
                  <div
                    className={
                      f.descuadre
                        ? "rounded-md border border-[var(--warning-bg)] bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning-text)] flex items-start gap-2"
                        : "rounded-md border border-[var(--success-bg)] bg-[var(--success-bg)] px-3 py-2 text-sm text-[var(--success-text)] flex items-start gap-2"
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
                          } respecto al efectivo acumulado en caja.`
                        : "Cuadra con el efectivo acumulado en caja."}
                    </span>
                  </div>
                )}

                {f.notas && <p className="text-sm text-[var(--text-body)]">«{f.notas}»</p>}

                {/* Declarar / corregir. Un arqueo recogido ya no se toca.
                    Y solo administración: el arqueo lo prepara quien cierra la
                    tienda el último día que abre, DENTRO de su cierre de turno (ticket
                    3b7e05d1). Tener aquí un segundo sitio donde declararlo se
                    presta a que se meta dos veces o a destiempo; esto queda como
                    lo que es, la pantalla de control, con la corrección en manos
                    de quien puede arreglarlo. */}
                {/* Al equipo se le dice dónde se hace, para que no busque aquí
                    un botón que ya no está. */}
                {f.estado === "sin_declarar" && !esAdmin && (
                  <p className="text-xs text-[var(--text-muted)]">
                    El arqueo se prepara al cerrar la tienda el último día que abre, desde tu
                    Cierre de turno.
                    Si hay algo que corregir, lo hace administración.
                  </p>
                )}

                {/* El arqueo se declaró contra un acumulado que ya no es el que
                    sale hoy: pasa cuando se corrige el saldo de partida DESPUÉS
                    de declarar. Se dice, en vez de dejar dos cifras que no
                    cuadran sin explicación (ticket 5a71fe28). */}
                {f.esperadoDesfasado && (
                  <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 flex items-start gap-2">
                    <HelpCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      Este arqueo se declaró contra un acumulado de{" "}
                      <strong className="tabular-nums">{eur(f.esperado ?? 0)}</strong>, y con los
                      saldos de hoy saldría{" "}
                      <strong className="tabular-nums">{eur(f.esperadoEnVivo ?? 0)}</strong> — el
                      saldo de partida de la tienda se corrigió después.
                      {esAdmin ? " Al corregir el arqueo puedes ponerlo al día." : ""}
                    </span>
                  </div>
                )}

                {/* Corregir un arqueo ya declarado —firmado o no— es cambiar
                    dinero que declaró otra persona: va con motivo y deja rastro,
                    en vez de sobrescribirlo en silencio (ticket 5a71fe28).
                    Declarar uno que no existe sigue siendo el otro formulario. */}
                {f.estado !== "sin_declarar" && esAdmin && (
                  corrigiendo === f.arqueoId ? (
                    <div className="rounded-md border border-[var(--border)] p-3 space-y-3">
                      <p className="text-sm text-[var(--text-body)]">
                        {f.estado === "recogido"
                          ? `Este arqueo ya lo firmó ${f.recogidoPor ?? "un responsable"}.`
                          : `Lo declaró ${f.declaradoPor ?? "la tienda"} y está esperando a que lo recojan.`}{" "}
                        Corrige los importes y di por qué: queda registrado con tu nombre.
                      </p>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor={`cor-declarado-${f.tiendaId}`}>
                            Efectivo que había en el sobre
                          </Label>
                          <Input
                            id={`cor-declarado-${f.tiendaId}`}
                            type="number"
                            step="0.01"
                            min="0"
                            className="mt-1 tabular-nums"
                            value={corDeclarado}
                            onChange={(e) => setCorDeclarado(e.target.value)}
                          />
                        </div>
                        {f.estado === "recogido" && (
                          <div>
                            <Label htmlFor={`cor-recogido-${f.tiendaId}`}>
                              Efectivo que se llevó
                            </Label>
                            <Input
                              id={`cor-recogido-${f.tiendaId}`}
                              type="number"
                              step="0.01"
                              min="0"
                              className="mt-1 tabular-nums"
                              value={corRecogido}
                              onChange={(e) => setCorRecogido(e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                      <div>
                        <Label htmlFor={`cor-motivo-${f.tiendaId}`}>Por qué lo corriges</Label>
                        <Input
                          id={`cor-motivo-${f.tiendaId}`}
                          className="mt-1"
                          value={corMotivo}
                          onChange={(e) => setCorMotivo(e.target.value)}
                          placeholder="Se contó dos veces un billete de 50; recuento con la tienda el lunes."
                        />
                      </div>
                      {f.esperadoDesfasado && (
                        <label className="flex items-start gap-2 cursor-pointer text-sm text-[var(--text-body)]">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                            checked={corRecalcular}
                            onChange={(e) => setCorRecalcular(e.target.checked)}
                          />
                          <span>
                            Poner al día el acumulado esperado:{" "}
                            <span className="tabular-nums">{eur(f.esperado ?? 0)}</span> →{" "}
                            <strong className="tabular-nums">{eur(f.esperadoEnVivo ?? 0)}</strong>
                          </span>
                        </label>
                      )}

                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setCorrigiendo(null)}>
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          disabled={guardando || corMotivo.trim().length < 5}
                          onClick={() => void corregir(f)}
                        >
                          {guardando ? "Guardando…" : "Guardar corrección"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Button variant="outline" size="sm" onClick={() => abrirCorreccion(f)}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />
                        Corregir arqueo
                      </Button>
                    </div>
                  )
                )}

                {/* El rastro, para todos: el empleado tiene derecho a ver que le
                    han cambiado su arqueo y por qué. */}
                {f.correcciones.length > 0 && (
                  <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Corregido por administración
                    </p>
                    {f.correcciones.map((c) => (
                      <p key={c.id} className="text-xs text-[var(--text-body)]">
                        <span className="tabular-nums">
                          {eur(c.declaradoAntes)} → <strong>{eur(c.declaradoDespues)}</strong>
                        </span>
                        {c.recogidoAntes !== c.recogidoDespues && (
                          <span className="tabular-nums">
                            {" "}· se llevó {eur(c.recogidoAntes ?? 0)} →{" "}
                            <strong>{eur(c.recogidoDespues ?? 0)}</strong>
                          </span>
                        )}
                        {" · "}
                        {c.quien}, {fechaCorta(c.cuando.slice(0, 10))} · «{c.motivo}»
                      </p>
                    ))}
                  </div>
                )}

                {/* `esAdmin` NO envuelve este bloque entero a propósito: dentro
                    vive el botón de firmar la recogida, y quien recoge el dinero
                    suele ser un responsable que no es administrador. Cada cosa
                    lleva su propia condición. */}
                {f.estado !== "recogido" && (esAdmin || datos?.yo.puedeRecoger) && (
                  <>
                    {declarando === f.tiendaId ? (
                      <div className="rounded-md border border-[var(--border)] p-3 space-y-3">
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor={`efectivo-${f.tiendaId}`}>
                              Efectivo que va al sobre
                            </Label>
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
                        {f.estado === "sin_declarar" && esAdmin && (
                          <Button variant="outline" size="sm" onClick={() => abrirDeclaracion(f)}>
                            Declarar efectivo
                          </Button>
                        )}
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
                      <div className="rounded-md border border-[var(--border)] p-3 space-y-3">
                        <p className="text-sm text-[var(--text-body)]">
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
        <p className="text-sm text-[var(--text-muted)]">
          Pueden recoger efectivo:{" "}
          {datos?.autorizados
            .filter((a) => a.conPin)
            .map((a) => a.nombre)
            .join(", ") || "nadie con PIN asignado todavía"}
          .
        </p>
      )}

      <DialogoEntregaSobres
        abierto={entregando}
        onCerrar={() => setEntregando(false)}
        onFirmado={() => {
          void cargar();
          void contarPendientes();
        }}
      />

      {esAdmin && <GestionRecogedores onCambio={cargar} />}
    </div>
  );
}
