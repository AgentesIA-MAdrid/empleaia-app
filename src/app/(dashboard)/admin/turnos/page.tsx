"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Send, Download, Settings2, Trash2, Pencil, UserPlus, Copy, Search, Coffee } from "lucide-react";
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

interface Tienda { id: string; nombre: string; color: string; activa: boolean }
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

interface Tramo { horaApertura: string; horaCierre: string }

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const CUSTOM = "__custom__";

// Día de la semana en la convención de HorarioSede (0=Lun…6=Dom). JS
// getDay() es 0=Dom, de ahí el +6 % 7. Se construye desde componentes
// locales para no depender de la zona horaria del ISO.
const diaSemanaSede = (fecha: Date): number => (fecha.getDay() + 6) % 7;
const diaSemanaDeFecha = (f: string): number => {
  const [y, m, d] = f.split("-").map(Number);
  if (!y || !m || !d) return -1;
  return diaSemanaSede(new Date(y, m - 1, d));
};

// Etiqueta orientativa de la franja según la hora de apertura.
const franjaLabel = (horaApertura: string): string => {
  const h = Number(horaApertura.split(":")[0]);
  if (h < 14) return "Mañana";
  if (h < 20) return "Tarde";
  return "Noche";
};

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
  // Horarios de apertura por sede: tiendaId → diaSemana (0=Lun…6=Dom) → tramos.
  // Sirven para prerellenar el turno con el horario real de la sede en vez de
  // un rango fijo 09:00–17:00.
  const [horariosSede, setHorariosSede] = useState<Record<string, Record<number, Tramo[]>>>({});
  const [horasGlobal, setHorasGlobal] = useState(40);
  const [loading, setLoading] = useState(false);
  // Solo la primera carga muestra el esqueleto a pantalla completa. En las
  // recargas posteriores (tras crear/editar/borrar un turno) mantenemos la
  // tabla ya pintada para no colapsar su altura: si el <tbody> se reduce a una
  // fila, el contenedor scrolleable encoge y el navegador salta al principio.
  const [primeraCarga, setPrimeraCarga] = useState(true);

  const [turnoDialog, setTurnoDialog] = useState(false);
  const [turnoForm, setTurnoForm] = useState(TURNO_FORM_INICIAL);
  const [submitting, setSubmitting] = useState(false);
  const [copiandoSemana, setCopiandoSemana] = useState(false);

  const [tiposDialog, setTiposDialog] = useState(false);
  const [tipoForm, setTipoForm] = useState(TIPO_FORM_INICIAL);

  // Correturnos: personas añadidas manualmente a una sede SOLO para la
  // semana visible (tiendaId -> userIds). Se reinicia al cambiar de semana;
  // la persistencia real surge de tener ≥1 turno en esa sede esa semana.
  const [visitantesManual, setVisitantesManual] = useState<Record<string, string[]>>({});
  const [addDialog, setAddDialog] = useState<{ tiendaId: string; nombre: string } | null>(null);
  const [addSel, setAddSel] = useState("");
  const [addBusqueda, setAddBusqueda] = useState("");

  const inicioSemana = startOfWeek(semana, { weekStartsOn: 1 });
  const finSemana = endOfWeek(semana, { weekStartsOn: 1 });
  const dias = Array.from({ length: 7 }, (_, i) => addDays(inicioSemana, i));
  const semanaKey = inicioSemana.toISOString();

  useEffect(() => {
    // Las sedes desactivadas (activa=false) no deben aparecer en el cuadrante
    // ni en sus selectores: alinea la vista interactiva con la exportación,
    // que ya filtra por `activa: true`. El endpoint /api/tiendas devuelve todas
    // (la gestión de sedes las necesita para reactivarlas), así que filtramos aquí.
    fetch("/api/tiendas").then(r => r.json()).then(d =>
      setTiendas((d.tiendas || []).filter((t: Tienda) => t.activa)));
    fetch("/api/turnos/tipos").then(r => r.json()).then(d => setTipos(Array.isArray(d) ? d : []));
    fetch("/api/configuracion").then(r => r.json()).then(d => {
      if (typeof d?.horasSemanales === "number") setHorasGlobal(d.horasSemanales);
    });
  }, []);

  // Carga los horarios de apertura de cada sede para poder prerellenar los
  // turnos con la mañana/tarde de la sede. Un fetch por sede (mismo endpoint
  // que el diálogo de horarios); si una falla, esa sede queda sin tramos.
  useEffect(() => {
    if (tiendas.length === 0) return;
    let cancelado = false;
    Promise.all(tiendas.map(t =>
      fetch(`/api/tiendas/${t.id}/horarios`)
        .then(r => r.ok ? r.json() : { tramos: [] })
        .then(d => ({ id: t.id, tramos: (d.tramos ?? []) as (Tramo & { diaSemana: number })[] }))
        .catch(() => ({ id: t.id, tramos: [] as (Tramo & { diaSemana: number })[] })),
    )).then(res => {
      if (cancelado) return;
      const map: Record<string, Record<number, Tramo[]>> = {};
      for (const { id, tramos } of res) {
        const porDia: Record<number, Tramo[]> = {};
        for (const tr of tramos) {
          (porDia[tr.diaSemana] ??= []).push({ horaApertura: tr.horaApertura, horaCierre: tr.horaCierre });
        }
        map[id] = porDia;
      }
      setHorariosSede(map);
    });
    return () => { cancelado = true; };
  }, [tiendas]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, turnosRes, ausRes] = await Promise.all([
        // Solo empleados activos: los desactivados no se planifican en el
        // cuadrante (aparecían en "Sin sede" y en sus sedes). Alinea la vista
        // interactiva con la exportación, que ya filtra por `activo: true`.
        fetch("/api/empleados?activo=true"),
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
      setPrimeraCarga(false);
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
    turnos
      .filter(t =>
        t.userId === userId
        && (tiendaId === null || t.tiendaId === tiendaId)
        && isSameDay(new Date(t.fecha), dia))
      // El API solo ordena por fecha, así que varios turnos del mismo día
      // salían en orden de creación. Ordenamos por hora de inicio para que
      // la mañana quede siempre arriba y la tarde debajo. "HH:MM" con cero a
      // la izquierda ordena cronológicamente como texto.
      .sort((a, b) => (a.horaInicio || "").localeCompare(b.horaInicio || ""));

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
  // `removible` marca a los correturnos que se añadieron a mano y aún no tienen
  // turnos en la sede esa semana: solo esos se pueden quitar de la lista con la
  // × del nombre (si tienen turnos, primero se borran con la × de cada turno).
  const filasDeGrupo = (grupoId: string | null): { emp: Empleado; visitante: boolean; removible: boolean }[] => {
    if (grupoId === null) {
      return empleados.filter(e => !e.tiendaId).map(emp => ({ emp, visitante: false, removible: false }));
    }
    const fijos = empleados.filter(e => e.tiendaId === grupoId);
    const fijosIds = new Set(fijos.map(e => e.id));
    const conTurno = new Set<string>();
    turnos.forEach(t => { if (t.tiendaId === grupoId && !fijosIds.has(t.userId)) conTurno.add(t.userId); });
    const manualIds = new Set((visitantesManual[grupoId] ?? []).filter(id => !fijosIds.has(id)));
    const visitanteIds = new Set<string>([...conTurno, ...manualIds]);
    const visitantes = empleados.filter(e => visitanteIds.has(e.id));
    return [
      ...fijos.map(emp => ({ emp, visitante: false, removible: false })),
      ...visitantes.map(emp => ({ emp, visitante: true, removible: manualIds.has(emp.id) && !conTurno.has(emp.id) })),
    ];
  };

  const disponiblesParaAñadir = addDialog
    ? (() => {
        const yaEn = new Set(filasDeGrupo(addDialog.tiendaId).map(f => f.emp.id));
        return empleados.filter(e => !yaEn.has(e.id));
      })()
    : [];

  const disponiblesFiltrados = (() => {
    const q = addBusqueda.trim().toLowerCase();
    if (!q) return disponiblesParaAñadir;
    return disponiblesParaAñadir.filter(e =>
      `${e.nombre} ${e.apellidos}`.toLowerCase().includes(q),
    );
  })();

  const confirmarAñadirPersona = () => {
    if (!addDialog || !addSel) return;
    setVisitantesManual(prev => ({
      ...prev,
      [addDialog.tiendaId]: [...(prev[addDialog.tiendaId] ?? []), addSel],
    }));
    setAddDialog(null);
    setAddSel("");
    setAddBusqueda("");
  };

  // Quita de la semana un correturno añadido a mano (solo estado local, no BD).
  // Se puede volver a añadir con "Añadir persona".
  const quitarCorreturno = (tiendaId: string, userId: string) => {
    setVisitantesManual(prev => ({
      ...prev,
      [tiendaId]: (prev[tiendaId] ?? []).filter(id => id !== userId),
    }));
  };

  const contratoDe = (emp: Empleado) =>
    emp.horasSemanalesContrato != null && emp.horasSemanalesContrato !== ""
      ? Number(emp.horasSemanalesContrato)
      : horasGlobal;

  // ---- Turno: crear / editar / borrar ----
  const abrirNuevoTurno = (emp: Empleado, dia: Date, tiendaId: string | null) => {
    const sedeId = tiendaId || emp.tiendaId || (tiendas[0]?.id ?? "");
    // Si la sede tiene horario ese día, el turno nace con el primer tramo
    // (normalmente la mañana) como rango personalizado en vez del 09:00–17:00
    // fijo. Se puede cambiar de tramo o ajustar a mano en el diálogo.
    const tramoSede = horariosSede[sedeId]?.[diaSemanaSede(dia)]?.[0];
    setTurnoForm({
      ...TURNO_FORM_INICIAL,
      userId: emp.id,
      tiendaId: sedeId,
      fecha: format(dia, "yyyy-MM-dd"),
      ...(tramoSede
        ? { tipoTurnoId: CUSTOM, horaInicio: tramoSede.horaApertura, horaFin: tramoSede.horaCierre }
        : { tipoTurnoId: tipos[0]?.id ?? CUSTOM }),
    });
    setTurnoDialog(true);
  };

  // Primer tipo de turno marcado como "día libre" (esLibre). Sirve para el
  // atajo de la celda; los tipos ya vienen ordenados por `orden`/`nombre`.
  const tipoLibre = tipos.find(t => t.esLibre);

  // Atajo del cuadrante: marca un día como libre creando un turno con el tipo
  // "día libre" (0h) sin abrir el diálogo. Reutiliza el mismo POST /api/turnos
  // que el alta manual. Si el cliente no ha definido ningún tipo libre, guía a
  // crearlo desde "Tipos de turno" en vez de crear un turno sin sentido.
  const marcarDiaLibre = async (emp: Empleado, dia: Date, tiendaId: string | null) => {
    if (!tipoLibre) {
      toast({ title: "Crea antes un tipo de turno marcado como “día libre” en Tipos de turno", variant: "destructive" });
      return;
    }
    const sedeId = tiendaId || emp.tiendaId || (tiendas[0]?.id ?? "");
    if (!sedeId) {
      toast({ title: "No hay sede a la que asignar el día libre", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch("/api/turnos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: emp.id,
          tiendaId: sedeId,
          tipoTurnoId: tipoLibre.id,
          fecha: format(dia, "yyyy-MM-dd"),
          estado: "BORRADOR",
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Día libre asignado" });
      fetchData();
    } catch {
      toast({ title: "Error al asignar el día libre", variant: "destructive" });
    }
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error al guardar el turno");
      }
      toast({ title: turnoForm.id ? "Turno actualizado" : "Turno creado" });
      setTurnoDialog(false);
      fetchData();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Error al guardar el turno", variant: "destructive" });
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

  // Arrastrar un turno lo COPIA (mismo tipo, horario, nota y estado) en CADA
  // día por el que pasa el cursor durante el arrastre —no solo en la celda
  // donde se suelta—, "pintando" la fila. Los destinos recorridos se acumulan
  // en un ref mientras dura el gesto y las copias se crean todas de una vez al
  // soltar: si se recargara a mitad de arrastre (`fetchData`), el `<button>`
  // origen se desmontaría y el navegador abortaría el drag. La semana visible
  // es el único alcance posible (solo hay celdas-destino para sus 7 días) y las
  // celdas con ausencia se excluyen solas (su `onDragOver` sale antes de
  // registrar el destino).
  const arrastreRef = useRef<{
    turnoId: string;
    destinos: Map<string, { emp: Empleado; dia: Date; tiendaId: string | null }>;
  } | null>(null);

  // onDragStart del turno origen: abre un gesto nuevo con su lista de destinos.
  const iniciarArrastre = (turnoId: string) => {
    arrastreRef.current = { turnoId, destinos: new Map() };
  };

  // onDragOver de cada celda válida: registra la celda recorrida (una sola vez).
  const registrarDestino = (emp: Empleado, dia: Date, tiendaId: string | null) => {
    const arrastre = arrastreRef.current;
    if (!arrastre) return;
    const clave = `${emp.id}|${tiendaId ?? ""}|${format(dia, "yyyy-MM-dd")}`;
    if (!arrastre.destinos.has(clave)) arrastre.destinos.set(clave, { emp, dia, tiendaId });
  };

  // onDragEnd sin drop (ESC o soltar fuera de una celda): descarta el gesto.
  const cancelarArrastre = () => { arrastreRef.current = null; };

  // onDrop sobre una celda válida: crea las copias de todos los destinos
  // recorridos y recarga una sola vez.
  const finalizarArrastre = async () => {
    const arrastre = arrastreRef.current;
    arrastreRef.current = null; // Captura síncrona: evita commits dobles con onDragEnd.
    if (!arrastre) return;
    const origen = turnos.find(t => t.id === arrastre.turnoId);
    if (!origen) return;
    const destinos = [...arrastre.destinos.values()].filter(({ emp, dia, tiendaId }) => {
      const destinoTienda = tiendaId ?? origen.tiendaId;
      // Nunca la celda de origen.
      if (origen.userId === emp.id && destinoTienda === origen.tiendaId && isSameDay(new Date(origen.fecha), dia)) {
        return false;
      }
      // Ni celdas que ya tengan un turno idéntico: pasar el cursor por encima no
      // debe duplicarlo (el gesto recorre muchas celdas).
      const yaExiste = turnos.some(t =>
        t.userId === emp.id
        && t.tiendaId === destinoTienda
        && isSameDay(new Date(t.fecha), dia)
        && (t.tipoTurno?.id ?? null) === (origen.tipoTurno?.id ?? null)
        && t.horaInicio === origen.horaInicio
        && t.horaFin === origen.horaFin);
      return !yaExiste;
    });
    if (destinos.length === 0) return;
    try {
      const res = await Promise.all(destinos.map(({ emp, dia, tiendaId }) =>
        fetch("/api/turnos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: emp.id,
            tiendaId: tiendaId ?? origen.tiendaId,
            tipoTurnoId: origen.tipoTurno?.id ?? null,
            fecha: format(dia, "yyyy-MM-dd"),
            horaInicio: origen.horaInicio,
            horaFin: origen.horaFin,
            nota: origen.nota,
            estado: origen.estado,
          }),
        }),
      ));
      if (res.some(r => !r.ok)) throw new Error();
      toast({ title: destinos.length === 1 ? "Turno copiado" : `Turno copiado a ${destinos.length} días` });
    } catch {
      toast({ title: "Error al copiar el turno", variant: "destructive" });
    } finally {
      // Recarga siempre: en un fallo parcial algunas copias sí se crearon y la
      // tabla debe reflejarlo (mismo patrón que `copiarDiaASemana`).
      fetchData();
    }
  };

  // Copia los turnos de un día al resto de la semana visible para ESE empleado
  // en ESA sede. Lo raro es que el horario cambie dentro de la misma semana, así
  // que se reemplazan los turnos que el empleado ya tenga los otros 6 días (en
  // esta sede) para que toda la semana quede igual que el día de origen. Solo
  // afecta a este empleado y esta semana: nunca toca a otras personas ni a otras
  // semanas (el alcance lo fija `turnosDe`/`dias`). Reutiliza los endpoints
  // reales POST/DELETE como `copiarTurno` y `publicarTodos`.
  const copiarDiaASemana = async (emp: Empleado, dia: Date, tiendaId: string | null) => {
    const origen = turnosDe(emp.id, dia, tiendaId);
    if (origen.length === 0) return;
    const destinos = dias.filter(d => !isSameDay(d, dia));
    const ok = confirm(
      `¿Copiar los turnos del ${format(dia, "EEEE d", { locale: es })} al resto de la semana para ${emp.nombre}? `
      + "Se reemplazarán los turnos que ya tenga esos días en esta sede.",
    );
    if (!ok) return;
    setCopiandoSemana(true);
    try {
      // 1) Borrar lo que haya en los días destino (mismo empleado y sede).
      const aBorrar = destinos.flatMap(d => turnosDe(emp.id, d, tiendaId));
      await Promise.all(aBorrar.map(t => fetch(`/api/turnos/${t.id}`, { method: "DELETE" })));
      // 2) Crear una copia fiel de cada turno de origen en cada día destino.
      await Promise.all(destinos.flatMap(d => origen.map(t =>
        fetch("/api/turnos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: emp.id,
            tiendaId: tiendaId ?? t.tiendaId,
            tipoTurnoId: t.tipoTurno?.id ?? null,
            fecha: format(d, "yyyy-MM-dd"),
            horaInicio: t.horaInicio,
            horaFin: t.horaFin,
            nota: t.nota,
            estado: t.estado,
          }),
        }),
      )));
      toast({ title: "Día copiado al resto de la semana" });
    } catch {
      toast({ title: "Error al copiar el día", variant: "destructive" });
    } finally {
      setCopiandoSemana(false);
      fetchData();
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
        {/* Altura acotada para que el scroll vertical ocurra DENTRO de la tarjeta
            (no en <main>): así el <thead> sticky ancla a este contenedor de
            scroll y la cabecera de días queda fija mientras se desplazan las
            sedes. overflow-auto conserva además el scroll horizontal (min-w). */}
        <CardContent className="p-0 overflow-auto max-h-[calc(100vh-16rem)]">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 border-b">
              <tr className="bg-slate-50">
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
              {loading && primeraCarga ? (
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
                    onPaintStart={iniciarArrastre}
                    onRegistrarDestino={registrarDestino}
                    onPaintEnd={finalizarArrastre}
                    onPaintCancel={cancelarArrastre}
                    onCopiarSemana={copiarDiaASemana}
                    onMarcarLibre={marcarDiaLibre}
                    copiandoSemana={copiandoSemana}
                    onAddPersona={grupo.id
                      ? () => { setAddSel(""); setAddDialog({ tiendaId: grupo.id as string, nombre: grupo.nombre }); }
                      : undefined}
                    onQuitarCorreturno={quitarCorreturno}
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
            {(horariosSede[turnoForm.tiendaId]?.[diaSemanaDeFecha(turnoForm.fecha)] ?? []).length > 0 && (
              <div>
                <Label>Horario de la sede</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(horariosSede[turnoForm.tiendaId]?.[diaSemanaDeFecha(turnoForm.fecha)] ?? []).map((tr, i) => {
                    const activo = turnoForm.tipoTurnoId === CUSTOM
                      && turnoForm.horaInicio === tr.horaApertura && turnoForm.horaFin === tr.horaCierre;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setTurnoForm(f => ({ ...f, tipoTurnoId: CUSTOM, horaInicio: tr.horaApertura, horaFin: tr.horaCierre }))}
                        className={cn(
                          "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                          activo
                            ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                            : "border-slate-200 text-slate-600 hover:border-[var(--primary)] hover:text-[var(--primary)]",
                        )}
                      >
                        {franjaLabel(tr.horaApertura)} · {tr.horaApertura}–{tr.horaCierre}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-slate-400">Elige un tramo de la sede o ajústalo abajo en “Personalizado”.</p>
              </div>
            )}
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
      <Dialog open={!!addDialog} onOpenChange={o => { if (!o) { setAddDialog(null); setAddSel(""); setAddBusqueda(""); } }}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Añadir persona a {addDialog?.nombre}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-500">
              Añade a alguien para cubrir esta semana en esta sede (por ejemplo un correturno).
              Solo aparece en la semana actual; asígnale turnos con el botón “+”.
            </p>
            <div>
              <Label>Persona</Label>
              <div className="relative mt-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Buscar por nombre…"
                  className="pl-9"
                  value={addBusqueda}
                  onChange={e => setAddBusqueda(e.target.value)}
                />
              </div>
              <div className="mt-2 max-h-[50vh] overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100">
                {disponiblesFiltrados.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-slate-400">
                    {disponiblesParaAñadir.length === 0 ? "No hay más empleados disponibles" : "Sin resultados"}
                  </p>
                ) : disponiblesFiltrados.map(e => (
                  <label key={e.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="add-persona"
                      className="h-4 w-4 border-slate-300 accent-[var(--primary)]"
                      checked={addSel === e.id}
                      onChange={() => setAddSel(e.id)}
                    />
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {e.nombre} {e.apellidos}{!e.tiendaId ? <span className="font-normal text-slate-400"> · sin sede</span> : ""}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddDialog(null); setAddSel(""); setAddBusqueda(""); }}>Cancelar</Button>
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
  grupo, filas, dias, totalCols, turnosDe, ausenciasDe, totalSemana, contratoDe, onAdd, onEdit, onDelete, onPaintStart, onRegistrarDestino, onPaintEnd, onPaintCancel, onCopiarSemana, onMarcarLibre, copiandoSemana, onAddPersona, onQuitarCorreturno,
}: {
  grupo: { id: string | null; nombre: string; color: string };
  filas: { emp: Empleado; visitante: boolean; removible: boolean }[];
  dias: Date[];
  totalCols: number;
  turnosDe: (userId: string, dia: Date, tiendaId: string | null) => Turno[];
  ausenciasDe: (userId: string, dia: Date) => Ausencia[];
  totalSemana: (userId: string, tiendaId: string | null) => number;
  contratoDe: (emp: Empleado) => number;
  onAdd: (emp: Empleado, dia: Date, tiendaId: string | null) => void;
  onEdit: (t: Turno) => void;
  onDelete: (id: string) => void;
  onPaintStart: (turnoId: string) => void;
  onRegistrarDestino: (emp: Empleado, dia: Date, tiendaId: string | null) => void;
  onPaintEnd: () => void;
  onPaintCancel: () => void;
  onCopiarSemana: (emp: Empleado, dia: Date, tiendaId: string | null) => void;
  onMarcarLibre: (emp: Empleado, dia: Date, tiendaId: string | null) => void;
  copiandoSemana: boolean;
  onAddPersona?: () => void;
  onQuitarCorreturno: (tiendaId: string, userId: string) => void;
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
      ) : filas.map(({ emp, visitante, removible }) => {
        const total = totalSemana(emp.id, grupo.id);
        const contrato = contratoDe(emp);
        // El contrato es semanal y global (de la persona), no por sede. La
        // diferencia debe medirse contra las horas del empleado en TODAS las
        // sedes, no solo en esta: si no, quien reparte su jornada entre varias
        // tiendas aparece como deficitario en cada una (se le pediría el
        // contrato completo en cada sede). En "Sin sede" (null) `total` ya es
        // global. Los correturnos (visitante) no muestran contrato/diferencia.
        const totalGlobal = grupo.id === null ? total : totalSemana(emp.id, null);
        const horasOtrasSedes = Math.round((totalGlobal - total) * 100) / 100;
        const dif = Math.round((totalGlobal - contrato) * 100) / 100;
        return (
          <tr key={emp.id} className="border-b border-slate-50 hover:bg-slate-50/60">
            <td className="px-3 py-2">
              <span className="text-sm font-medium text-slate-800 truncate block max-w-[160px]">{emp.nombre} {emp.apellidos}</span>
              {visitante && (
                <span className="mt-0.5 inline-flex items-center gap-1">
                  <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Correturno</span>
                  {removible && grupo.id && (
                    <button
                      type="button"
                      onClick={() => onQuitarCorreturno(grupo.id as string, emp.id)}
                      title="Quitar correturno de esta sede"
                      aria-label={`Quitar a ${emp.nombre} ${emp.apellidos} de esta sede`}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-amber-600 hover:bg-amber-200 transition-colors text-[11px] leading-none"
                    >×</button>
                  )}
                </span>
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
                onPaintStart={onPaintStart}
                onRegistrarDestino={onRegistrarDestino}
                onPaintEnd={onPaintEnd}
                onPaintCancel={onPaintCancel}
                onCopiarSemana={onCopiarSemana}
                onMarcarLibre={onMarcarLibre}
                copiandoSemana={copiandoSemana}
              />
            ))}
            <td className="px-2 py-2 text-center font-semibold text-slate-700">
              {Math.round(total * 100) / 100}h
              {!visitante && horasOtrasSedes > 0 && (
                <div className="text-[10px] font-normal text-slate-400" title="Horas de esta persona en otras sedes esta semana (cuentan para su contrato)">
                  +{horasOtrasSedes}h otras sedes
                </div>
              )}
            </td>
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

// Celda de un día: muestra los turnos de la persona y permite arrastrarlos por
// la fila para copiarlos en cada día recorrido (drag & drop nativo, sin
// librerías). Cada celda que pisa el cursor se registra como destino y todas
// las copias se crean al soltar.
function CeldaDia({
  emp, dia, tiendaId, turnos, ausencias, onAdd, onEdit, onDelete, onPaintStart, onRegistrarDestino, onPaintEnd, onPaintCancel, onCopiarSemana, onMarcarLibre, copiandoSemana,
}: {
  emp: Empleado;
  dia: Date;
  tiendaId: string | null;
  turnos: Turno[];
  ausencias: Ausencia[];
  onAdd: (emp: Empleado, dia: Date, tiendaId: string | null) => void;
  onEdit: (t: Turno) => void;
  onDelete: (id: string) => void;
  onPaintStart: (turnoId: string) => void;
  onRegistrarDestino: (emp: Empleado, dia: Date, tiendaId: string | null) => void;
  onPaintEnd: () => void;
  onPaintCancel: () => void;
  onCopiarSemana: (emp: Empleado, dia: Date, tiendaId: string | null) => void;
  onMarcarLibre: (emp: Empleado, dia: Date, tiendaId: string | null) => void;
  copiandoSemana: boolean;
}) {
  const [sobre, setSobre] = useState(false);

  // Persona ausente (baja, vacaciones…) ese día: no se le puede añadir ni
  // copiar un turno encima. Se ocultan el botón "+" y se rechaza el drop.
  const enAusencia = ausencias.length > 0;

  return (
    <td
      className={cn(
        "px-1 py-1.5 text-center align-top transition-colors",
        sobre && "rounded-md bg-slate-100 ring-2 ring-inset ring-[var(--primary)]",
      )}
      onDragOver={(e) => {
        if (enAusencia) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setSobre(true);
        // Cada celda que pisa el cursor durante el arrastre se pinta al soltar.
        onRegistrarDestino(emp, dia, tiendaId);
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        if (enAusencia) return;
        e.preventDefault();
        setSobre(false);
        onPaintEnd();
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
            onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "copy"; onPaintStart(t.id); }}
            onDragEnd={onPaintCancel}
            onClick={() => onEdit(t)}
            className={cn(
              "group relative mx-auto block w-fit cursor-grab rounded-md px-1 py-1 text-xs font-medium leading-tight active:cursor-grabbing",
              t.estado === "PUBLICADO" ? "text-white" : "border border-dashed border-slate-300 text-slate-600",
            )}
            style={t.estado === "PUBLICADO" ? { backgroundColor: t.tipoTurno?.color || "var(--primary)" } : undefined}
            title={t.nota ? `${t.nota} · arrastra por los días para copiar` : "Arrastra por los días para copiar en cada uno"}
          >
            <div>{etiquetaTurno(t)}</div>
            <div className="opacity-80">{horasDeTurno(t)}h</div>
            <span
              onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
              className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[10px]"
            >×</span>
          </button>
        ))}
        {turnos.length > 0 && (
          <button
            type="button"
            disabled={copiandoSemana}
            onClick={() => onCopiarSemana(emp, dia, tiendaId)}
            className="w-full inline-flex items-center justify-center gap-1 rounded-md py-0.5 text-[10px] text-slate-400 hover:text-[var(--primary)] transition-colors disabled:opacity-50"
            title="Copiar este día al resto de la semana (este empleado)"
          >
            <Copy className="h-3 w-3" /> Semana
          </button>
        )}
        {!enAusencia && (
          <button
            className="w-full rounded-md border border-dashed border-slate-200 text-slate-300 hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors py-0.5 text-xs"
            onClick={() => onAdd(emp, dia, tiendaId)}
          >+</button>
        )}
        {/* Atajo día libre: solo en días sin turnos (un día libre = sin trabajo). */}
        {!enAusencia && turnos.length === 0 && (
          <button
            type="button"
            onClick={() => onMarcarLibre(emp, dia, tiendaId)}
            className="w-full inline-flex items-center justify-center gap-1 rounded-md py-0.5 text-[10px] text-slate-400 hover:text-[var(--primary)] transition-colors"
            title="Marcar este día como libre"
          >
            <Coffee className="h-3 w-3" /> Libre
          </button>
        )}
      </div>
    </td>
  );
}
