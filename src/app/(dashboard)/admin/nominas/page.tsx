"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Calculator,
  Lock,
  Loader2,
  Download,
  Play,
  RefreshCw,
  Trash2,
  Plus,
  LockOpen,
  CheckCircle2,
  Pencil,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/hooks/use-toast";

type EstadoPrenomina = "BORRADOR" | "CERRADA" | "ENVIADA";
type TipoConcepto =
  | "DIETA"
  | "KILOMETRAJE"
  | "COMISION"
  | "PLUS"
  | "BONUS"
  | "DEDUCCION"
  | "OTRO";

interface Concepto {
  id: string;
  tipo: TipoConcepto;
  descripcion: string;
  cantidad: number | null;
  importe: number;
  notas: string | null;
}

interface Prenomina {
  id: string;
  empleadoId: string;
  nombre: string;
  apellidos: string;
  email: string;
  dni: string | null;
  estado: EstadoPrenomina;
  horasTrabajadas: number;
  horasOrdinarias: number;
  horasExtras: number;
  horasNocturnas: number;
  horasFestivas: number;
  diasTrabajados: number;
  diasAusenciaPagada: number;
  diasAusenciaNoPagada: number;
  salarioBase: number;
  importeHorasExtras: number;
  importeNocturnidad: number;
  importeFestivos: number;
  importeConceptos: number;
  totalBruto: number;
  moneda: string;
  comentario: string | null;
  calculadaAt: string | null;
  cerradaAt: string | null;
  cerradaPor: string | null;
  enviadaAt: string | null;
  conceptos: Concepto[];
}

const TIPOS_CONCEPTO: { value: TipoConcepto; label: string }[] = [
  { value: "DIETA", label: "Dieta" },
  { value: "KILOMETRAJE", label: "Kilometraje" },
  { value: "COMISION", label: "Comisión" },
  { value: "PLUS", label: "Plus" },
  { value: "BONUS", label: "Bonus" },
  { value: "DEDUCCION", label: "Deducción" },
  { value: "OTRO", label: "Otro" },
];

function estadoTone(e: EstadoPrenomina): "warning" | "success" | "info" {
  if (e === "BORRADOR") return "warning";
  if (e === "ENVIADA") return "info";
  return "success";
}

function fmtMoney(n: number, moneda: string) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: moneda || "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

export default function PrenominaPage() {
  const { toast } = useToast();
  const [periodo, setPeriodo] = useState(() => new Date().toISOString().slice(0, 7));
  const [gestor, setGestor] = useState<"generico" | "sage" | "a3">("generico");
  const [rows, setRows] = useState<Prenomina[]>([]);
  const [horasTeoricas, setHorasTeoricas] = useState(0);
  const [diasLab, setDiasLab] = useState(0);
  const [moneda, setMoneda] = useState("EUR");
  const [loading, setLoading] = useState(false);
  const [calculando, setCalculando] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [detalle, setDetalle] = useState<Prenomina | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/prenomina?periodo=${periodo}`);
      if (r.status === 402) {
        setUnavailable(true);
        return;
      }
      const d = await r.json();
      setRows(d.empleados ?? []);
      setHorasTeoricas(d.horasTeoricas ?? 0);
      setDiasLab(d.diasLaborables ?? 0);
      setMoneda(d.moneda ?? "EUR");
    } finally {
      setLoading(false);
    }
  }, [periodo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Refresca el detalle abierto cuando rows cambia (tras añadir concepto, etc.)
  useEffect(() => {
    if (!detalle) return;
    const updated = rows.find((r) => r.id === detalle.id);
    if (updated) setDetalle(updated);
  }, [rows, detalle]);

  const calcular = async () => {
    setCalculando(true);
    try {
      const r = await fetch(`/api/prenomina?periodo=${periodo}`, { method: "POST" });
      if (!r.ok) throw new Error("Error al calcular");
      const data = await r.json();
      toast({
        title: "Prenómina calculada",
        description: `${data.creadas} creadas · ${data.actualizadas} actualizadas · ${data.saltadas} saltadas (cerradas)`,
      });
      await fetchData();
    } catch {
      toast({ title: "Error al calcular", variant: "destructive" });
    } finally {
      setCalculando(false);
    }
  };

  const cerrar = async (id: string) => {
    if (!confirm("¿Cerrar esta prenómina? No podrá modificarse hasta reabrir.")) return;
    const r = await fetch(`/api/prenomina/${id}/cerrar`, { method: "POST" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast({ title: d.error ?? "Error", variant: "destructive" });
      return;
    }
    toast({ title: "Prenómina cerrada" });
    await fetchData();
  };

  const reabrir = async (id: string) => {
    const r = await fetch(`/api/prenomina/${id}/reabrir`, { method: "POST" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast({ title: d.error ?? "Error", variant: "destructive" });
      return;
    }
    toast({ title: "Prenómina reabierta" });
    await fetchData();
  };

  const enviar = async (id: string) => {
    const canal = window.prompt(
      "Canal de envío (manual / sage / a3 / email)",
      "manual",
    );
    if (!canal) return;
    const destinatario =
      canal === "email"
        ? window.prompt("Email del gestor laboral", "")
        : window.prompt("Referencia / destinatario (opcional)", "") || null;
    if (canal === "email" && !destinatario) return;
    const r = await fetch(`/api/prenomina/${id}/enviar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canal, destinatario }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast({ title: d.error ?? "Error al enviar", variant: "destructive" });
      return;
    }
    toast({ title: "Prenómina marcada como ENVIADA" });
    await fetchData();
  };

  const enviarTodas = async () => {
    const pendientes = rows.filter((r) => r.estado === "CERRADA");
    if (pendientes.length === 0) {
      toast({
        title: "No hay prenominas CERRADAS",
        description: "Cierra primero las prenominas que quieras enviar.",
      });
      return;
    }
    const canal = window.prompt(
      `Marcar ${pendientes.length} prenominas como ENVIADAS. Canal (manual / sage / a3)`,
      "manual",
    );
    if (!canal) return;
    const destinatario =
      window.prompt("Referencia / destinatario (opcional)", "") || null;
    const r = await fetch(
      `/api/prenomina/enviar?periodo=${periodo}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal, destinatario }),
      },
    );
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast({ title: d.error ?? "Error al enviar", variant: "destructive" });
      return;
    }
    const d = await r.json();
    toast({ title: `${d.enviadas} prenominas marcadas como ENVIADAS` });
    await fetchData();
  };

  const exportar = async (formato: "csv" | "xlsx") => {
    const r = await fetch(
      `/api/prenomina/exportar?periodo=${periodo}&formato=${formato}&gestor=${gestor}`,
    );
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast({ title: d.error ?? "Error al exportar", variant: "destructive" });
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const sufijo = gestor === "generico" ? "" : `_${gestor}`;
    a.download = `prenomina_${periodo}${sufijo}.${formato}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">
                Prenómina — plan Pro o superior
              </p>
              <p className="text-sm text-amber-800 mt-0.5">
                Calcula nóminas, gestiona conceptos manuales y exporta a Sage/A3.
              </p>
            </div>
            <Link href="/admin/planes">
              <Button size="sm">Ver planes</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalGeneral = rows.reduce((acc, r) => acc + r.totalBruto, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <Calculator className="h-5 w-5 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Prenómina</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Snapshot mensual con horas, extras, ausencias y conceptos editables — listo para tu gestor laboral
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 flex items-end gap-3 flex-wrap">
          <div>
            <Label>Periodo</Label>
            <Input
              className="mt-1 w-40"
              type="month"
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
            />
          </div>
          <Button onClick={calcular} disabled={calculando}>
            {calculando ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1.5" />
            )}
            {rows.length === 0 ? "Calcular prenómina" : "Recalcular"}
          </Button>
          <Button variant="outline" onClick={() => fetchData()}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refrescar
          </Button>
          <div className="flex gap-2 ml-auto flex-wrap items-end">
            <div>
              <Label className="text-xs">Layout</Label>
              <Select value={gestor} onValueChange={(v) => setGestor(v as typeof gestor)}>
                <SelectTrigger className="w-32 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="generico">Genérico</SelectItem>
                  <SelectItem value="sage">Sage</SelectItem>
                  <SelectItem value="a3">A3NOM</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => exportar("csv")} disabled={rows.length === 0}>
              <Download className="h-4 w-4 mr-1.5" /> CSV
            </Button>
            <Button variant="outline" onClick={() => exportar("xlsx")} disabled={rows.length === 0}>
              <Download className="h-4 w-4 mr-1.5" /> Excel
            </Button>
            <Button
              variant="outline"
              onClick={enviarTodas}
              disabled={rows.filter((r) => r.estado === "CERRADA").length === 0}
              title="Marcar todas las prenominas CERRADAS de este periodo como ENVIADAS al gestor"
            >
              <Send className="h-4 w-4 mr-1.5" /> Enviar todas
            </Button>
          </div>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">Empleados</p>
              <p className="text-2xl font-bold mt-1 text-slate-900">{rows.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">Días laborables</p>
              <p className="text-2xl font-bold mt-1 text-slate-900">{diasLab}</p>
              <p className="text-xs text-slate-500 mt-1">{horasTeoricas}h teóricas</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">Cerradas</p>
              <p className="text-2xl font-bold mt-1 text-emerald-600">
                {rows.filter((r) => r.estado !== "BORRADOR").length} / {rows.length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">Total bruto</p>
              <p className="text-2xl font-bold mt-1 text-[var(--primary)]">
                {fmtMoney(totalGeneral, moneda)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500 text-sm">
            Sin prenominas para el periodo. Pulsa <strong>Calcular prenómina</strong> para generarlas a partir de los fichajes y ausencias del mes.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Detalle por empleado</CardTitle>
          </CardHeader>
          <CardContent className="hidden md:block p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {[
                    "DNI",
                    "Empleado",
                    "Estado",
                    "Días",
                    "Horas",
                    "Extras",
                    "Ausencias",
                    "Conceptos",
                    "Total bruto",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className={`text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500${(h === "DNI" || h === "Conceptos" || h === "Ausencias") ? " hidden lg:table-cell" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="hidden lg:table-cell px-4 py-3 text-slate-500 tabular-nums">{r.dni ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {r.apellidos}, {r.nombre}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={estadoTone(r.estado)} label={r.estado.toLowerCase()} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{r.diasTrabajados}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-slate-900">
                      {r.horasTrabajadas.toFixed(1)}h
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className={r.horasExtras > 0 ? "text-amber-600" : "text-slate-400"}>
                        {r.horasExtras > 0 ? `+${r.horasExtras.toFixed(1)}h` : "—"}
                      </span>
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 tabular-nums text-slate-700">
                      {r.diasAusenciaPagada + r.diasAusenciaNoPagada}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 tabular-nums">
                      <span className={r.importeConceptos !== 0 ? "text-emerald-600" : "text-slate-400"}>
                        {r.conceptos.length === 0 ? "—" : `${r.conceptos.length} (${fmtMoney(r.importeConceptos, r.moneda)})`}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums font-bold text-[var(--primary)]">
                      {fmtMoney(r.totalBruto, r.moneda)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setDetalle(r)}
                          title="Ver detalle / conceptos"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {r.estado === "BORRADOR" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => cerrar(r.id)}
                            title="Cerrar prenómina"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          </Button>
                        )}
                        {r.estado === "CERRADA" && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => enviar(r.id)}
                              title="Marcar como enviada al gestor"
                            >
                              <Send className="h-3.5 w-3.5 text-blue-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => reabrir(r.id)}
                              title="Reabrir (solo OWNER)"
                            >
                              <LockOpen className="h-3.5 w-3.5 text-amber-600" />
                            </Button>
                          </>
                        )}
                        {r.estado === "ENVIADA" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => reabrir(r.id)}
                            title="Reabrir (solo OWNER)"
                          >
                            <LockOpen className="h-3.5 w-3.5 text-amber-600" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>

          {/* Vista de tarjetas (móvil) */}
          <CardContent className="md:hidden space-y-3 p-4">
            {rows.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 text-sm truncate">
                      {r.apellidos}, {r.nombre}
                    </p>
                    {r.dni && (
                      <p className="text-xs text-slate-500 tabular-nums">{r.dni}</p>
                    )}
                  </div>
                  <StatusPill tone={estadoTone(r.estado)} label={r.estado.toLowerCase()} />
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">Total bruto</p>
                    <p className="text-lg font-bold tabular-nums text-[var(--primary)]">
                      {fmtMoney(r.totalBruto, r.moneda)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setDetalle(r)}
                      title="Ver detalle / conceptos"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {r.estado === "BORRADOR" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => cerrar(r.id)}
                        title="Cerrar prenómina"
                      >
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      </Button>
                    )}
                    {r.estado === "CERRADA" && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => enviar(r.id)}
                          title="Marcar como enviada al gestor"
                        >
                          <Send className="h-4 w-4 text-blue-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => reabrir(r.id)}
                          title="Reabrir (solo OWNER)"
                        >
                          <LockOpen className="h-4 w-4 text-amber-600" />
                        </Button>
                      </>
                    )}
                    {r.estado === "ENVIADA" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => reabrir(r.id)}
                        title="Reabrir (solo OWNER)"
                      >
                        <LockOpen className="h-4 w-4 text-amber-600" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <DetalleDialog
        prenomina={detalle}
        onClose={() => setDetalle(null)}
        onChanged={() => fetchData()}
      />
    </div>
  );
}

function DetalleDialog({
  prenomina,
  onClose,
  onChanged,
}: {
  prenomina: Prenomina | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [tipo, setTipo] = useState<TipoConcepto>("DIETA");
  const [descripcion, setDescripcion] = useState("");
  const [importe, setImporte] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!prenomina) return null;

  const editable = prenomina.estado === "BORRADOR";

  const addConcepto = async () => {
    if (!descripcion.trim() || !importe.trim()) {
      toast({ title: "Rellena descripción e importe", variant: "destructive" });
      return;
    }
    const imp = parseFloat(importe.replace(",", "."));
    if (isNaN(imp)) {
      toast({ title: "Importe inválido", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`/api/prenomina/${prenomina.id}/conceptos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          descripcion: descripcion.trim(),
          importe: imp,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? "Error");
      }
      setDescripcion("");
      setImporte("");
      onChanged();
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : "Error al añadir",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const removeConcepto = async (conceptoId: string) => {
    const r = await fetch(
      `/api/prenomina/${prenomina.id}/conceptos?conceptoId=${conceptoId}`,
      { method: "DELETE" },
    );
    if (!r.ok) {
      toast({ title: "Error al borrar", variant: "destructive" });
      return;
    }
    onChanged();
  };

  return (
    <Dialog open={!!prenomina} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Prenómina · {prenomina.nombre} {prenomina.apellidos}
          </DialogTitle>
        </DialogHeader>

        {/* Cifras calculadas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Metric label="Horas trabajadas" value={`${prenomina.horasTrabajadas.toFixed(1)}h`} />
          <Metric label="Horas extra" value={`+${prenomina.horasExtras.toFixed(1)}h`} tone="warning" />
          <Metric label="Horas nocturnas" value={`${prenomina.horasNocturnas.toFixed(1)}h`} />
          <Metric label="Horas festivas" value={`${prenomina.horasFestivas.toFixed(1)}h`} />
          <Metric label="Días trabajados" value={`${prenomina.diasTrabajados}`} />
          <Metric label="Ausencias pagadas" value={`${prenomina.diasAusenciaPagada} días`} />
          <Metric label="Ausencias no pagadas" value={`${prenomina.diasAusenciaNoPagada} días`} />
          <Metric label="Estado" value={prenomina.estado} />
        </div>

        {/* Desglose económico */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Desglose económico</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label="Salario base" value={fmtMoney(prenomina.salarioBase, prenomina.moneda)} />
            <Row label="Importe horas extras" value={fmtMoney(prenomina.importeHorasExtras, prenomina.moneda)} />
            <Row label="Importe nocturnidad" value={fmtMoney(prenomina.importeNocturnidad, prenomina.moneda)} />
            <Row label="Importe festivos" value={fmtMoney(prenomina.importeFestivos, prenomina.moneda)} />
            <Row label="Importe conceptos manuales" value={fmtMoney(prenomina.importeConceptos, prenomina.moneda)} />
            <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between font-bold text-base">
              <span>Total bruto</span>
              <span className="text-[var(--primary)]">{fmtMoney(prenomina.totalBruto, prenomina.moneda)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Conceptos manuales */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Conceptos manuales</CardTitle>
          </CardHeader>
          <CardContent>
            {prenomina.conceptos.length === 0 ? (
              <p className="text-sm text-slate-400 py-2">Sin conceptos añadidos.</p>
            ) : (
              <div className="space-y-2 mb-3">
                {prenomina.conceptos.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-md border border-slate-100 bg-slate-50"
                  >
                    <span className="text-xs uppercase tracking-wide font-semibold text-slate-500 w-24">
                      {TIPOS_CONCEPTO.find((t) => t.value === c.tipo)?.label ?? c.tipo}
                    </span>
                    <span className="flex-1 text-sm text-slate-900">{c.descripcion}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {fmtMoney(c.importe, prenomina.moneda)}
                    </span>
                    {editable && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeConcepto(c.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {editable && (
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-3">
                  <Select value={tipo} onValueChange={(v) => setTipo(v as TipoConcepto)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_CONCEPTO.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  className="col-span-6"
                  placeholder="Descripción"
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  step="0.01"
                  placeholder="Importe"
                  value={importe}
                  onChange={(e) => setImporte(e.target.value)}
                />
                <Button
                  className="col-span-1"
                  size="icon"
                  onClick={addConcepto}
                  disabled={submitting}
                  title="Añadir concepto"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
            {!editable && (
              <p className="text-xs text-slate-500 italic">
                Prenómina cerrada. Reabre desde la tabla para editar conceptos.
              </p>
            )}
          </CardContent>
        </Card>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning";
}) {
  const color = tone === "warning" ? "text-amber-600" : "text-slate-900";
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-xs uppercase tracking-wide font-medium text-slate-500">{label}</p>
      <p className={`text-base font-bold tabular-nums mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 text-slate-700">
      <span>{label}</span>
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  );
}
