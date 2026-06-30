"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Send, Download, Settings2, Trash2, Pencil, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { addDays, startOfWeek, endOfWeek, format, addWeeks, subWeeks, isSameDay, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { horasDeTurno, etiquetaTurno } from "@/lib/turnos/horas";

interface Tienda { id: string; nombre: string; color: string }
interface Empleado {
  id: string; nombre: string; apellidos: string;
  tiendaId: string | null;
  horasSemanalesContrato: number | string | null;
}
interface TipoTurnoRef {
  id: string; nombre: string; abreviatura: string;
  color: string; horas: number | string; esLibre: boolean;
}
interface TipoTurno extends TipoTurnoRef {
  horaInicio: string | null; horaFin: string | null; orden: number;
}
interface Turno {
  id: string; userId: string; tiendaId: string; fecha: string;
  horaInicio: string; horaFin: string; nota?: string;
  estado: "BORRADOR" | "PUBLICADO";
  tipoTurno?: TipoTurnoRef | null;
}
interface Ausencia {
  id: string; userId: string; fechaInicio: string; fechaFin: string;
  tipoAusencia: { nombre: string; color: string };
}

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const CUSTOM = "__custom__";

const TURNO_FORM_INICIAL = {
  id: "", userId: "", tiendaId: "", fecha: "",
  tipoTurnoId: "", horaInicio: "09:00", horaFin: "17:00",
  nota: "", estado: "BORRADOR" as "BORRADOR" | "PUBLICADO",
};

const TIPO_FORM_INICIAL = {
  id: "", nombre: "", abreviatura: "", color: "#6366f1",
  horaInicio: "", horaFin: "", horas: "", esLibre: false,
};

export default function AdminTurnosPage() {
  const { toast } = useToast();
  const [semana, setSemana] = useState(new Date());
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [filtroTienda, setFiltroTienda] = useState<string>("todas");
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [ausencias, setAusencias] = useState<Ausencia[]>([]);
  const [tipos, setTipos] = useState<TipoTurno[]>([]);
  const [horasGlobal, setHorasGlobal] = useState(40);
  const [loading, setLoading] = useState(false);

  const [turnoDialog, setTurnoDialog] = useState(false);
  const [turnoForm, setTurnoForm] = useState(TURNO_FORM_INICIAL);
  const [submitting, setSubmitting] = useState(false);

  const [tiposDialog, setTiposDialog] = useState(false);
  const [tipoForm, setTipoForm] = useState(TIPO_FORM_INICIAL);

  // Correturnos: personas añadidas manualmente a una sede SOLO para la
  // semana visible (tiendaId -> userIds). Se reinicia al cambiar de semana;
  // la persistencia real surge de tener ≥1 turno en esa sede esa semana.
  const [visitantesManual, setVisitantesManual] = useState<Record<string, string[]>>({});
  const [addDialog, setAddDialog] = useState<{ tiendaId: string; nombre: string } | null>(null);
  const [addSel, setAddSel] = useState("");

  const inicioSemana = startOfWeek(semana, { weekStartsOn: 1 });
  const finSemana = endOfWeek(semana, { weekStartsOn: 1 });
  const dias = Array.from({ length: 7 }, (_, i) => addDays(inicioSemana, i));
  const semanaKey = inicioSemana.toISOString();

  useEffect(() => {
    fetch("/api/tiendas").then(r => r.json()).then(d => setTiendas(d.tiendas || []));
    fetch("/api/turnos/tipos").then(r => r.json()).then(d => setTipos(Array.isArray(d) ? d : []));
    fetch("/api/configuracion").then(r => r.json()).then(d => {
      if (typeof d?.horasSemanales === "number") setHorasGlobal(d.horasSemanales);
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, turnosRes, ausRes] = await Promise.all([
        fetch("/api/empleados"),
        fetch(`/api/turnos?fechaInicio=${inicioSemana.toISOString()}&fechaFin=${finSemana.toISOString()}`),
        fetch("/api/ausencias?estado=APROBADA"),
      ]);
      const [empData, turnosData] = await Promise.all([empRes.json(), turnosRes.json()]);
      setEmpleados(empData.empleados || []);
      setTurnos(Array.isArray(turnosData) ? turnosData : (turnosData.turnos || []));
      // Ausencias aprobadas: la feature "ausencias_aprobacion" puede estar OFF
      // (402) o fallar la red → el cuadrante sigue funcionando sin pintarlas.
      if (ausRes.ok) {
        const ausData = await ausRes.json();
        setAusencias(Array.isArray(ausData) ? ausData : (ausData?.ausencias ?? []));
      } else {
        setAusencias([]);
      }
    } finally {
      setLoading(false);
    }
  }, [inicioSemana.toISOString(), finSemana.toISOString()]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Los correturnos añadidos a mano son "de esta semana": al navegar a
  // otra semana se limpian (los que tengan turnos reaparecen solos).
  useEffect(() => { setVisitantesManual({}); }, [semanaKey]);

  const recargarTipos = () =>
    fetch("/api/turnos/tipos").then(r => r.json()).then(d => setTipos(Array.isArray(d) ? d : []));

  // Grupos sede → empleados.
  const tiendasVisibles = filtroTienda === "todas"
    ? tiendas
    : tiendas.filter(t => t.id === filtroTienda);
  const grupos: { id: string | null; nombre: string; color: string }[] = [
    ...tiendasVisibles.map(t => ({ id: t.id as string | null, nombre: t.nombre, color: t.color })),
  ];
  if (filtroTienda === "todas" && empleados.some(e => !e.tiendaId)) {
    grupos.push({ id: null, nombre: "Sin sede", color: "#94a3b8" });
  }

  // En las sedes (tiendaId !== null) se cuenta solo lo de ESA sede, para que
  // un correturno aparezca con sus horas en la tienda que cubre. En "Sin
  // sede" (null) no se filtra: muestra la carga global de la persona.
  const turnosDe = (userId: string, dia: Date, tiendaId: string | null) =>
    turnos.filter(t =>
      t.userId === userId
      && (tiendaId === null || t.tiendaId === tiendaId)
      && isSameDay(new Date(t.fecha), dia));

  // Ausencias APROBADAS que solapan ese día natural (independiente de la sede:
  // la persona está ausente esté donde esté su turno). Franja con el color del
  // tipo, reutilizado del propio tipo (sin name-matching frágil multi-tenant).
  const ausenciasDe = (userId: string, dia: Date) =>
    ausencias.filter(a =>
      a.userId === userId
      && isWithinInterval(dia, {
        start: startOfDay(new Date(a.fechaInicio)),
        end: endOfDay(new Date(a.fechaFin)),
      }));

  const totalSemana = (userId: string, tiendaId: string | null) =>
    turnos
      .filter(t => t.userId === userId && (tiendaId === null || t.tiendaId === tiendaId))
      .reduce((s, t) => s + horasDeTurno(t), 0);

  // Filas de un grupo: empleados fijos de la sede + correturnos (visitantes)
  // que cubren esa semana (con turno en la sede o añadidos a mano).
  const filasDeGrupo = (grupoId: string | null): { emp: Empleado; visitante: boolean }[] => {
    if (grupoId === null) {
      return empleados.filter(e => !e.tiendaId).map(emp => ({ emp, visitante: false }));
    }
    const fijos = empleados.filter(e => e.tiendaId === grupoId);
    const fijosIds = new Set(fijos.map(e => e.id));
    const visitanteIds = new Set<string>();
    turnos.forEach(t => { if (t.tiendaId === grupoId && !fijosIds.has(t.userId)) visitanteIds.add(t.userId); });
    (visitantesManual[grupoId] ?? []).forEach(id => { if (!fijosIds.has(id)) visitanteIds.add(id); });
    const visitantes = empleados.filter(e => visitanteIds.has(e.id));
    return [
      ...fijos.map(emp => ({ emp, visitante: false })),
      ...visitantes.map(emp => ({ emp, visitante: true })),
    ];
  };

  const disponiblesParaAñadir = addDialog
    ? (() => {
        const yaEn = new Set(filasDeGrupo(addDialog.tiendaId).map(f => f.emp.id));
        return empleados.filter(e => !yaEn.has(e.id));
      })()
    : [];

  const confirmarAñadirPersona = () => {
    if (!addDialog || !addSel) return;
    setVisitantesManual(prev => ({
      ...prev,
      [addDialog.tiendaId]: [...(prev[addDialog.tiendaId] ?? []), addSel],
    }));
    setAddDialog(null);
    setAddSel("");
  };

  const contratoDe = (emp: Empleado) =>
    emp.horasSemanalesContrato != null && emp.horasSemanalesContrato !== ""
      ? Number(emp.horasSemanalesContrato)
      : horasGlobal;

  // ---- Turno: crear / editar / borrar ----
  const abrirNuevoTurno = (emp: Empleado, dia: Date, tiendaId: string | null) => {
    setTurnoForm({
      ...TURNO_FORM_INICIAL,
      userId: emp.id,
      tiendaId: tiendaId || emp.tiendaId || (tiendas[0]?.id ?? ""),
      fecha: format(dia, "yyyy-MM-dd"),
      tipoTurnoId: tipos[0]?.id ?? CUSTOM,
    });
    setTurnoDialog(true);
  };

  const abrirEditarTurno = (t: Turno) => {
    setTurnoForm({
      id: t.id,
      userId: t.userId,
      tiendaId: t.tiendaId,
      fecha: format(new Date(t.fecha), "yyyy-MM-dd"),
      tipoTurnoId: t.tipoTurno?.id ?? CUSTOM,
      horaInicio: t.horaInicio || "09:00",
      horaFin: t.horaFin || "17:00",
      nota: t.nota || "",
      estado: t.estado,
    });
    setTurnoDialog(true);
  };

  const guardarTurno = async () => {
    if (!turnoForm.userId || !turnoForm.tiendaId || !turnoForm.fecha) {
      toast({ title: "Faltan empleado, sede o fecha", variant: "destructive" });
      return;
    }
    const esCustom = turnoForm.tipoTurnoId === CUSTOM;
    const body: Record<string, unknown> = {
      userId: turnoForm.userId,
      tiendaId: turnoForm.tiendaId,
      fecha: turnoForm.fecha,
      tipoTurnoId: esCustom ? null : turnoForm.tipoTurnoId,
      nota: turnoForm.nota,
      estado: turnoForm.estado,
    };
    if (esCustom) {
      body.horaInicio = turnoForm.horaInicio;
      body.horaFin = turnoForm.horaFin;
    }
    setSubmitting(true);
    try {
      const url = turnoForm.id ? `/api/turnos/${turnoForm.id}` : "/api/turnos";
      const res = await fetch(url, {
        method: turnoForm.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast({ title: turnoForm.id ? "Turno actualizado" : "Turno creado" });
      setTurnoDialog(false);
      fetchData();
    } catch {
      toast({ title: "Error al guardar el turno", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const borrarTurno = async (id: string) => {
    try {
      await fetch(`/api/turnos/${id}`, { method: "DELETE" });
      fetchData();
    } catch {
      toast({ title: "Error al eliminar", variant: "destructive" });
    }
  };

  // Arrastrar un turno a otra celda de la misma semana lo COPIA (mismo tipo,
  // horario, nota y estado) en el día/persona destino. Evita reintroducir a
  // mano turnos que se repiten. La semana visible es el único alcance posible
  // porque solo hay celdas-destino para sus 7 días.
  const copiarTurno = async (turnoId: string, emp: Empleado, dia: Date, tiendaId: string | null) => {
    const origen = turnos.find(t => t.id === turnoId);
    if (!origen) return;
    const destinoTienda = tiendaId ?? origen.tiendaId;
    // Soltar sobre la misma celda de origen: no hacer nada.
    if (origen.userId === emp.id && destinoTienda === origen.tiendaId && isSameDay(new Date(origen.fecha), dia)) {
      return;
    }
    try {
      const res = await fetch("/api/turnos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: emp.id,
          tiendaId: destinoTienda,
          tipoTurnoId: origen.tipoTurno?.id ?? null,
          fecha: format(dia, "yyyy-MM-dd"),
          horaInicio: origen.horaInicio,
          horaFin: origen.horaFin,
          nota: origen.nota,
          estado: origen.estado,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Turno copiado" });
      fetchData();
    } catch {
      toast({ title: "Error al copiar el turno", variant: "destructive" });
    }
  };

  const publicarTodos = async () => {
    const borradores = turnos.filter(t => t.estado === "BORRADOR");
    await Promise.all(borradores.map(t =>
      fetch(`/api/turnos/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado: "PUBLICADO" }) })
    ));
    toast({ title: `${borradores.length} turnos publicados` });
    fetchData();
  };

  const exportar = () => {
    const params = new URLSearchParams({
      fechaInicio: inicioSemana.toISOString(),
      fechaFin: finSemana.toISOString(),
    });
    if (filtroTienda !== "todas") params.set("tiendaId", filtroTienda);
    window.open(`/api/turnos/cuadrante/exportar?${params.toString()}`, "_blank");
  };

  // ---- Tipos de turno: CRUD ----
  const guardarTipo = async () => {
    if (!tipoForm.nombre) {
      toast({ title: "El nombre es obligatorio", variant: "destructive" });
      return;
    }
    const body = {
      nombre: tipoForm.nombre,
      abreviatura: tipoForm.abreviatura,
      color: tipoForm.color,
      horaInicio: tipoForm.horaInicio || null,
      horaFin: tipoForm.horaFin || null,
      horas: tipoForm.horas === "" ? 0 : Number(tipoForm.horas),
      esLibre: tipoForm.esLibre,
    };
    try {
      const url = tipoForm.id ? `/api/turnos/tipos/${tipoForm.id}` : "/api/turnos/tipos";
      const res = await fetch(url, {
        method: tipoForm.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast({ title: tipoForm.id ? "Tipo actualizado" : "Tipo creado" });
      setTipoForm(TIPO_FORM_INICIAL);
      recargarTipos();
    } catch {
      toast({ title: "Error al guardar el tipo", variant: "destructive" });
    }
  };

  const borrarTipo = async (id: string) => {
    if (!confirm("¿Desactivar este tipo de turno?")) return;
    try {
      await fetch(`/api/turnos/tipos/${id}`, { method: "DELETE" });
      recargarTipos();
    } catch {
      toast({ title: "Error al eliminar", variant: "destructive" });
    }
  };

  const totalCols = 2 + 7 + 3;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cuadrante de Turnos</h1>
          <p className="text-slate-500 text-sm mt-1">{format(inicioSemana, "d MMM", { locale: es })} – {format(finSemana, "d MMM yyyy", { locale: es })}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filtroTienda} onValueChange={setFiltroTienda}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las sedes</SelectItem>
              {tiendas.map(t => <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => { setTipoForm(TIPO_FORM_INICIAL); setTiposDialog(true); }}>
            <Settings2 className="h-4 w-4 mr-2" /> Tipos de turno
          </Button>
          <Button variant="outline" onClick={exportar}>
            <Download className="h-4 w-4 mr-2" /> Excel
          </Button>
          {turnos.some(t => t.estado === "BORRADOR") && (
            <Button variant="outline" onClick={publicarTodos}>
              <Send className="h-4 w-4 mr-2" /> Publicar todos
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setSemana(subWeeks(semana, 1))}><ChevronLeft className="h-5 w-5" /></Button>
        <span className="font-semibold text-slate-700">Semana {format(inicioSemana, "w")} de {format(inicioSemana, "yyyy")}</span>
        <Button variant="ghost" size="icon" onClick={() => setSemana(addWeeks(semana, 1))}><ChevronRight className="h-5 w-5" /></Button>
        <Button variant="ghost" size="sm" onClick={() => setSemana(new Date())}>Hoy</Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left text-xs font-semibold text-slate-500 px-3 py-3 w-44">Empleado</th>
                {dias.map((d, i) => {
                  const hoy = isSameDay(d, new Date());
                  return (
                    <th key={i} className={cn("text-center text-xs font-semibold px-1 py-3", hoy ? "text-[var(--primary)]" : "text-slate-500")}>
                      <div>{DIAS[i]}</div>
                      <div className={cn("text-base font-bold", hoy ? "text-[var(--primary)]" : "text-slate-700")}>{format(d, "d")}</div>
                    </th>
                  );
                })}
                <th className="text-center text-xs font-semibold text-slate-500 px-2 py-3 w-20">Total</th>
                <th className="text-center text-xs font-semibold text-slate-500 px-2 py-3 w-24">Contrato</th>
                <th className="text-center text-xs font-semibold text-slate-500 px-2 py-3 w-20">Dif.</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={totalCols} className="px-4 py-3"><div className="h-10 bg-slate-100 rounded animate-pulse" /></td></tr>
              ) : grupos.length === 0 ? (
                <tr><td colSpan={totalCols} className="text-center py-8 text-slate-400">No hay sedes. Crea una sede primero.</td></tr>
              ) : (
                grupos.map(grupo => (
                  <GrupoSede
                    key={grupo.id ?? "sin-sede"}
                    grupo={grupo}
                    filas={filasDeGrupo(grupo.id)}
                    dias={dias}
                    totalCols={totalCols}
                    turnosDe={turnosDe}
                    ausenciasDe={ausenciasDe}
                    totalSemana={totalSemana}
                    contratoDe={contratoDe}
                    onAdd={abrirNuevoTurno}
                    onEdit={abrirEditarTurno}
                    onDelete={borrarTurno}
                    onCopy={copiarTurno}
                    onAddPersona={grupo.id
                      ? () => { setAddSel(""); setAddDialog({ tiendaId: grupo.id as string, nombre: grupo.nombre }); }
                      : undefined}
                  />
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Dialog turno */}
      <Dialog open={turnoDialog} onOpenChange={setTurnoDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>{turnoForm.id ? "Editar turno" : "Nuevo turno"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Sede</Label>
              <Select value={turnoForm.tiendaId} onValueChange={v => setTurnoForm(f => ({ ...f, tiendaId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Sede..." /></SelectTrigger>
                <SelectContent>{tiendas.map(t => <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo de turno</Label>
              <Select value={turnoForm.tipoTurnoId} onValueChange={v => setTurnoForm(f => ({ ...f, tipoTurnoId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Tipo..." /></SelectTrigger>
                <SelectContent>
                  {tipos.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nombre} {t.esLibre ? "(libre)" : `· ${Number(t.horas)}h`}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>Personalizado (rango horario)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {turnoForm.tipoTurnoId === CUSTOM && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Hora inicio</Label><Input type="time" className="mt-1" value={turnoForm.horaInicio} onChange={e => setTurnoForm(f => ({ ...f, horaInicio: e.target.value }))} /></div>
                <div><Label>Hora fin</Label><Input type="time" className="mt-1" value={turnoForm.horaFin} onChange={e => setTurnoForm(f => ({ ...f, horaFin: e.target.value }))} /></div>
              </div>
            )}
            <div>
              <Label>Fecha</Label>
              <Input type="date" className="mt-1" value={turnoForm.fecha} onChange={e => setTurnoForm(f => ({ ...f, fecha: e.target.value }))} />
            </div>
            <div>
              <Label>Estado</Label>
              <Select value={turnoForm.estado} onValueChange={v => setTurnoForm(f => ({ ...f, estado: v as "BORRADOR" | "PUBLICADO" }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="BORRADOR">Borrador</SelectItem><SelectItem value="PUBLICADO">Publicado</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Nota (opcional)</Label><Input className="mt-1" value={turnoForm.nota} onChange={e => setTurnoForm(f => ({ ...f, nota: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTurnoDialog(false)}>Cancelar</Button>
            <Button onClick={guardarTurno} disabled={submitting}>{submitting ? "Guardando..." : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog añadir persona (correturno) a una sede esta semana */}
      <Dialog open={!!addDialog} onOpenChange={o => { if (!o) { setAddDialog(null); setAddSel(""); } }}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Añadir persona a {addDialog?.nombre}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-500">
              Añade a alguien para cubrir esta semana en esta sede (por ejemplo un correturno).
              Solo aparece en la semana actual; asígnale turnos con el botón “+”.
            </p>
            <div>
              <Label>Persona</Label>
              <Select value={addSel} onValueChange={setAddSel}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecciona empleado..." /></SelectTrigger>
                <SelectContent>
                  {disponiblesParaAñadir.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-slate-400">No hay más empleados disponibles</div>
                  ) : disponiblesParaAñadir.map(e => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre} {e.apellidos}{!e.tiendaId ? " · sin sede" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddDialog(null); setAddSel(""); }}>Cancelar</Button>
            <Button onClick={confirmarAñadirPersona} disabled={!addSel}>Añadir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog tipos de turno */}
      <Dialog open={tiposDialog} onOpenChange={setTiposDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Tipos de turno</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              {tipos.length === 0 ? (
                <p className="text-sm text-slate-400">Aún no hay tipos. Crea el primero abajo.</p>
              ) : tipos.map(t => (
                <div key={t.id} className="flex items-center gap-2 rounded-md border border-slate-100 px-2 py-1.5">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.color }} />
                  <span className="font-medium text-slate-800">{t.nombre}</span>
                  {t.abreviatura && <span className="text-xs text-slate-400">[{t.abreviatura}]</span>}
                  <span className="text-xs text-slate-500 ml-auto">{t.esLibre ? "libre" : `${Number(t.horas)}h`}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setTipoForm({
                    id: t.id, nombre: t.nombre, abreviatura: t.abreviatura, color: t.color,
                    horaInicio: t.horaInicio || "", horaFin: t.horaFin || "",
                    horas: String(Number(t.horas)), esLibre: t.esLibre,
                  })}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-red-50" onClick={() => borrarTipo(t.id)}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button>
                </div>
              ))}
            </div>

            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-semibold text-slate-700">{tipoForm.id ? "Editar tipo" : "Nuevo tipo"}</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Nombre *</Label><Input className="mt-1" placeholder="Mañana" value={tipoForm.nombre} onChange={e => setTipoForm(f => ({ ...f, nombre: e.target.value }))} /></div>
                <div><Label>Abreviatura</Label><Input className="mt-1" placeholder="M" value={tipoForm.abreviatura} onChange={e => setTipoForm(f => ({ ...f, abreviatura: e.target.value }))} /></div>
                <div><Label>Hora inicio</Label><Input type="time" className="mt-1" value={tipoForm.horaInicio} onChange={e => setTipoForm(f => ({ ...f, horaInicio: e.target.value }))} /></div>
                <div><Label>Hora fin</Label><Input type="time" className="mt-1" value={tipoForm.horaFin} onChange={e => setTipoForm(f => ({ ...f, horaFin: e.target.value }))} /></div>
                <div><Label>Horas que computa</Label><Input type="number" min={0} max={24} step={0.5} className="mt-1" placeholder="6" value={tipoForm.horas} onChange={e => setTipoForm(f => ({ ...f, horas: e.target.value }))} /></div>
                <div className="flex items-center gap-2 pt-6">
                  <input id="esLibre" type="checkbox" checked={tipoForm.esLibre} onChange={e => setTipoForm(f => ({ ...f, esLibre: e.target.checked }))} />
                  <Label htmlFor="esLibre" className="cursor-pointer">Es día libre (0h)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Label>Color</Label>
                  <input type="color" value={tipoForm.color} onChange={e => setTipoForm(f => ({ ...f, color: e.target.value }))} className="h-9 w-12 rounded border border-slate-200" />
                </div>
              </div>
              <div className="flex gap-2">
                {tipoForm.id && <Button variant="ghost" onClick={() => setTipoForm(TIPO_FORM_INICIAL)}>Cancelar edición</Button>}
                <Button className="ml-auto" onClick={guardarTipo}>{tipoForm.id ? "Actualizar tipo" : "Crear tipo"}</Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTiposDialog(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GrupoSede({
  grupo, filas, dias, totalCols, turnosDe, ausenciasDe, totalSemana, contratoDe, onAdd, onEdit, onDelete, onCopy, onAddPersona,
}: {
  grupo: { id: string | null; nombre: string; color: string };
  filas: { emp: Empleado; visitante: boolean }[];
  dias: Date[];
  totalCols: number;
  turnosDe: (userId: string, dia: Date, tiendaId: string | null) => Turno[];
  ausenciasDe: (userId: string, dia: Date) => Ausencia[];
  totalSemana: (userId: string, tiendaId: string | null) => number;
  contratoDe: (emp: Empleado) => number;
  onAdd: (emp: Empleado, dia: Date, tiendaId: string | null) => void;
  onEdit: (t: Turno) => void;
  onDelete: (id: string) => void;
  onCopy: (turnoId: string, emp: Empleado, dia: Date, tiendaId: string | null) => void;
  onAddPersona?: () => void;
}) {
  return (
    <>
      <tr style={{ backgroundColor: `${grupo.color}22` }}>
        <td colSpan={totalCols} className="px-3 py-2">
          <span className="flex items-center gap-2 font-semibold text-slate-700">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: grupo.color }} />
            {grupo.nombre}
            <span className="text-xs font-normal text-slate-400">({filas.length})</span>
            {onAddPersona && (
              <button
                onClick={onAddPersona}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" /> Añadir persona
              </button>
            )}
          </span>
        </td>
      </tr>
      {filas.length === 0 ? (
        <tr><td colSpan={totalCols} className="px-6 py-2 text-xs text-slate-400">Sin empleados en esta sede</td></tr>
      ) : filas.map(({ emp, visitante }) => {
        const total = totalSemana(emp.id, grupo.id);
        const contrato = contratoDe(emp);
        const dif = Math.round((total - contrato) * 100) / 100;
        return (
          <tr key={emp.id} className="border-b border-slate-50 hover:bg-slate-50/60">
            <td className="px-3 py-2">
              <span className="text-sm font-medium text-slate-800 truncate block max-w-[160px]">{emp.nombre} {emp.apellidos}</span>
              {visitante && (
                <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Correturno</span>
              )}
            </td>
            {dias.map((dia, i) => (
              <CeldaDia
                key={i}
                emp={emp}
                dia={dia}
                tiendaId={grupo.id}
                turnos={turnosDe(emp.id, dia, grupo.id)}
                ausencias={ausenciasDe(emp.id, dia)}
                onAdd={onAdd}
                onEdit={onEdit}
                onDelete={onDelete}
                onCopy={onCopy}
              />
            ))}
            <td className="px-2 py-2 text-center font-semibold text-slate-700">{Math.round(total * 100) / 100}h</td>
            {visitante ? (
              <>
                <td className="px-2 py-2 text-center text-slate-300" title="No aplica: el contrato se controla en su sede">—</td>
                <td className="px-2 py-2 text-center text-slate-300">—</td>
              </>
            ) : (
              <>
                <td className="px-2 py-2 text-center text-slate-500">{contrato}h</td>
                <td className={cn("px-2 py-2 text-center font-semibold", dif < 0 ? "text-red-600" : "text-emerald-600")}>
                  {dif > 0 ? "+" : ""}{dif}h
                </td>
              </>
            )}
          </tr>
        );
      })}
    </>
  );
}

// Celda de un día: muestra los turnos de la persona y permite arrastrarlos a
// otra celda de la semana para copiarlos (drag & drop nativo, sin librerías).
function CeldaDia({
  emp, dia, tiendaId, turnos, ausencias, onAdd, onEdit, onDelete, onCopy,
}: {
  emp: Empleado;
  dia: Date;
  tiendaId: string | null;
  turnos: Turno[];
  ausencias: Ausencia[];
  onAdd: (emp: Empleado, dia: Date, tiendaId: string | null) => void;
  onEdit: (t: Turno) => void;
  onDelete: (id: string) => void;
  onCopy: (turnoId: string, emp: Empleado, dia: Date, tiendaId: string | null) => void;
}) {
  const [sobre, setSobre] = useState(false);

  return (
    <td
      className={cn(
        "px-1 py-1.5 text-center align-top transition-colors",
        sobre && "rounded-md bg-slate-100 ring-2 ring-inset ring-[var(--primary)]",
      )}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setSobre(true); }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSobre(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onCopy(id, emp, dia, tiendaId);
      }}
    >
      <div className="space-y-1">
        {ausencias.map(a => (
          <div
            key={a.id}
            className="w-full rounded-md px-1 py-1 text-xs font-medium leading-tight text-white truncate"
            style={{ backgroundColor: a.tipoAusencia.color }}
            title={`${a.tipoAusencia.nombre} (ausencia aprobada)`}
          >
            {a.tipoAusencia.nombre}
          </div>
        ))}
        {turnos.map(t => (
          <button
            key={t.id}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "copy"; }}
            onClick={() => onEdit(t)}
            className={cn(
              "group relative w-full cursor-grab rounded-md px-1 py-1 text-xs font-medium leading-tight active:cursor-grabbing",
              t.estado === "PUBLICADO" ? "text-white" : "border border-dashed border-slate-300 text-slate-600",
            )}
            style={t.estado === "PUBLICADO" ? { backgroundColor: t.tipoTurno?.color || "var(--primary)" } : undefined}
            title={t.nota ? `${t.nota} · arrastra para copiar` : "Arrastra para copiar a otro día"}
          >
            <div>{etiquetaTurno(t)}</div>
            <div className="opacity-80">{horasDeTurno(t)}h</div>
            <span
              onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
              className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[10px]"
            >×</span>
          </button>
        ))}
        <button
          className="w-full rounded-md border border-dashed border-slate-200 text-slate-300 hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors py-0.5 text-xs"
          onClick={() => onAdd(emp, dia, tiendaId)}
        >+</button>
      </div>
    </td>
  );
}
