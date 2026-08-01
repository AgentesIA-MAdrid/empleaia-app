"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, TrendingUp, TrendingDown, Timer, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Empleado { id: string; nombre: string; apellidos: string; }
interface Entrada {
  id: string;
  userId: string;
  tipo: "ACUMULACION" | "CONSUMO";
  horas: number;
  concepto: string;
  fecha: string;
  user: { id: string; nombre: string; apellidos: string };
  aprobadoPor?: { id: string; nombre: string; apellidos: string };
}

const FORM_INICIAL = {
  userId: "", tipo: "ACUMULACION" as "ACUMULACION" | "CONSUMO",
  horas: "", concepto: "", fecha: new Date().toISOString().split("T")[0],
};

function formatHoras(h: number) {
  const abs = Math.abs(h);
  const hh = Math.floor(abs);
  const mm = Math.round((abs - hh) * 60);
  return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`;
}

export default function BolsaHorasPage() {
  const { toast } = useToast();
  const [entradas, setEntradas] = useState<Entrada[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [saldoMap, setSaldoMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filtroUserId, setFiltroUserId] = useState("todos");
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bolsa-horas");
      const data = await res.json();
      setEntradas(data.entradas || []);
      setEmpleados(data.empleados || []);
      setSaldoMap(data.saldoMap || {});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCrear = async () => {
    if (!form.userId || !form.horas || !form.concepto || !form.fecha) {
      toast({ title: "Rellena todos los campos", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/bolsa-horas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, horas: parseFloat(form.horas) }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Movimiento registrado" });
      setDialogOpen(false);
      setForm(FORM_INICIAL);
      fetchData();
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleEliminar = async (id: string) => {
    if (!confirm("¿Eliminar este movimiento?")) return;
    try {
      await fetch(`/api/bolsa-horas/${id}`, { method: "DELETE" });
      toast({ title: "Movimiento eliminado" });
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const toggleExpand = (userId: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  // Resumen por empleado
  const empleadosConSaldo = empleados.map((e) => ({
    ...e,
    saldo: saldoMap[e.id] ?? 0,
    entradas: entradas.filter((en) => en.userId === e.id),
  })).filter((e) => filtroUserId === "todos" || e.id === filtroUserId);

  const totalAcumulado = entradas.filter((e) => e.tipo === "ACUMULACION").reduce((acc, e) => acc + e.horas, 0);
  const totalConsumido = entradas.filter((e) => e.tipo === "CONSUMO").reduce((acc, e) => acc + e.horas, 0);
  const totalSaldo = totalAcumulado - totalConsumido;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">Bolsa de Horas</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">Gestión de horas extra y compensaciones</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Registrar movimiento
        </Button>
      </div>

      {/* Resumen global */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--success-bg)] flex items-center justify-center shrink-0">
              <TrendingUp className="h-5 w-5 text-[var(--success-text)]" />
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Total acumulado</p>
              <p className="text-xl font-bold text-[var(--success-text)]">{formatHoras(totalAcumulado)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--danger-bg)] flex items-center justify-center shrink-0">
              <TrendingDown className="h-5 w-5 text-[var(--danger)]" />
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Total consumido</p>
              <p className="text-xl font-bold text-[var(--danger)]">{formatHoras(totalConsumido)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
              totalSaldo >= 0 ? "bg-[var(--primary-light)]" : "bg-[var(--warning-bg)]")}>
              <Timer className={cn("h-5 w-5", totalSaldo >= 0 ? "text-[var(--primary)]" : "text-[var(--warning-text)]")} />
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Saldo total equipo</p>
              <p className={cn("text-xl font-bold", totalSaldo >= 0 ? "text-[var(--primary)]" : "text-[var(--warning-text)]")}>
                {totalSaldo >= 0 ? "+" : ""}{formatHoras(totalSaldo)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtro */}
      <div className="flex gap-3 flex-wrap">
        <Select value={filtroUserId} onValueChange={setFiltroUserId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Todos los empleados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los empleados</SelectItem>
            {empleados.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Lista por empleado */}
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-16 bg-[var(--muted)] rounded-xl animate-pulse" />)}</div>
      ) : empleadosConSaldo.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Timer className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-[var(--text-muted)]">No hay movimientos registrados</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {empleadosConSaldo.map((emp) => {
            const isExpanded = expandidos.has(emp.id);
            return (
              <div key={emp.id} className="bg-[var(--card)] rounded-xl border hover:shadow-sm transition-all">
                {/* Fila empleado */}
                <button
                  className="w-full flex items-center gap-4 p-4 text-left"
                  onClick={() => emp.entradas.length > 0 && toggleExpand(emp.id)}
                >
                  <div className="w-9 h-9 rounded-full bg-[var(--primary-light)] flex items-center justify-center text-[var(--primary)] font-semibold text-xs shrink-0">
                    {emp.nombre[0]}{emp.apellidos[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[var(--text-dark)] text-sm">{emp.nombre} {emp.apellidos}</p>
                    <p className="text-xs text-[var(--text-muted)]">{emp.entradas.length} movimientos</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className="text-xs text-[var(--text-muted)]">Saldo</p>
                      <p className={cn("font-bold text-sm", emp.saldo >= 0 ? "text-[var(--success-text)]" : "text-[var(--danger)]")}>
                        {emp.saldo >= 0 ? "+" : ""}{formatHoras(emp.saldo)}
                      </p>
                    </div>
                    {emp.entradas.length > 0 && (
                      isExpanded ? <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                    )}
                  </div>
                </button>

                {/* Movimientos del empleado */}
                {isExpanded && emp.entradas.length > 0 && (
                  <div className="border-t">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--muted)]">
                        <tr>
                          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2">Fecha</th>
                          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2">Tipo</th>
                          <th className="text-left text-xs font-semibold text-[var(--text-muted)] px-4 py-2">Concepto</th>
                          <th className="text-right text-xs font-semibold text-[var(--text-muted)] px-4 py-2">Horas</th>
                          <th className="px-4 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {emp.entradas.map((entrada) => (
                          <tr key={entrada.id} className="hover:bg-[var(--muted)]">
                            <td className="px-4 py-2 text-[var(--text-body)] text-xs">
                              {format(new Date(entrada.fecha), "d MMM yyyy", { locale: es })}
                            </td>
                            <td className="px-4 py-2">
                              <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium",
                                entrada.tipo === "ACUMULACION" ? "bg-[var(--success-bg)] text-[var(--success-text)]" : "bg-[var(--danger-bg)] text-[var(--danger)]")}>
                                {entrada.tipo === "ACUMULACION"
                                  ? <TrendingUp className="h-3 w-3" />
                                  : <TrendingDown className="h-3 w-3" />}
                                {entrada.tipo === "ACUMULACION" ? "Acumulación" : "Consumo"}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-[var(--text-body)]">{entrada.concepto}</td>
                            <td className={cn("px-4 py-2 text-right font-semibold",
                              entrada.tipo === "ACUMULACION" ? "text-[var(--success-text)]" : "text-[var(--danger)]")}>
                              {entrada.tipo === "ACUMULACION" ? "+" : "-"}{formatHoras(entrada.horas)}
                            </td>
                            <td className="px-4 py-2">
                              <button onClick={() => handleEliminar(entrada.id)}
                                className="p-1 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Dialog nuevo movimiento */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Registrar movimiento</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Empleado *</Label>
              <Select value={form.userId} onValueChange={(v) => setForm((f) => ({ ...f, userId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona empleado" /></SelectTrigger>
                <SelectContent>
                  {empleados.map((e) => <SelectItem key={e.id} value={e.id}>{e.nombre} {e.apellidos}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo *</Label>
                <Select value={form.tipo} onValueChange={(v: any) => setForm((f) => ({ ...f, tipo: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACUMULACION">
                      <span className="flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-[var(--success-text)]" /> Acumulación</span>
                    </SelectItem>
                    <SelectItem value="CONSUMO">
                      <span className="flex items-center gap-1.5"><TrendingDown className="h-3.5 w-3.5 text-[var(--danger)]" /> Consumo</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Horas *</Label>
                <Input className="mt-1" type="number" step="0.5" min="0.5" placeholder="2.5"
                  value={form.horas}
                  onChange={(e) => setForm((f) => ({ ...f, horas: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Concepto *</Label>
              <Input className="mt-1" placeholder="Ej: Horas extra jornada del viernes"
                value={form.concepto}
                onChange={(e) => setForm((f) => ({ ...f, concepto: e.target.value }))} />
            </div>
            <div>
              <Label>Fecha *</Label>
              <Input className="mt-1" type="date" value={form.fecha}
                onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} />
            </div>
            <div className={cn("rounded-lg p-3 text-sm flex items-center gap-2",
              form.tipo === "ACUMULACION" ? "bg-[var(--success-bg)] text-[var(--success-text)]" : "bg-[var(--danger-bg)] text-[var(--danger-text)]")}>
              {form.tipo === "ACUMULACION"
                ? <TrendingUp className="h-4 w-4 shrink-0" />
                : <TrendingDown className="h-4 w-4 shrink-0" />}
              {form.tipo === "ACUMULACION"
                ? "Se añadirán horas al saldo del empleado"
                : "Se descontarán horas del saldo del empleado"}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCrear} disabled={saving}>{saving ? "Guardando..." : "Registrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
