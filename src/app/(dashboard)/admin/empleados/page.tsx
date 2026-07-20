"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Plus, Search, Edit2, UserX, UserCheck, Trash2, Send, FileText, FileSpreadsheet, KeyRound, X, AlertTriangle, Loader2, ChevronDown, ChevronUp, Check, Download, Upload } from "lucide-react";
import type { ResultadoImportacion } from "@/lib/empleados/importar";
import { Button } from "@/components/ui/button";
import { FeatureGateClient } from "@/components/feature-gate-client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn, getColorRol, getLabelRol } from "@/lib/utils";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { StatusPill } from "@/components/ui/status-pill";

interface Empleado {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  dni?: string;
  telefono?: string;
  rol: "OWNER" | "MANAGER" | "EMPLEADO";
  activo: boolean;
  password: string | null;
  resetToken: string | null;
  tiendaId?: string;
  managerId?: string;
  tienda?: { nombre: string; color: string };
  sedes?: { tiendaId: string; principal: boolean; tienda: { id: string; nombre: string; color: string } }[];
  horasSemanalesContrato?: number | string | null;
  turnoOficinaPorDefecto?: boolean;
}

function getEstadoEmpleado(emp: Empleado): { label: string; tone: "warning" | "neutral" | "success" } {
  if (!emp.password) return { label: "Invitación pendiente", tone: "warning" };
  if (!emp.activo) return { label: "Inactivo", tone: "neutral" };
  return { label: "Activo", tone: "success" };
}

const CHEVRON_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")";

/**
 * Selector de rol en línea (pill con su color + chevron). Definido a nivel
 * de módulo a propósito: declararlo dentro del render dispararía la regla
 * react-hooks/static-components.
 */
function RolSelectInline({
  rol,
  disabled,
  onChange,
}: {
  rol: Empleado["rol"];
  disabled: boolean;
  onChange: (rol: Empleado["rol"]) => void;
}) {
  return (
    <select
      value={rol}
      disabled={disabled}
      aria-label="Cambiar rol"
      onChange={(e) => onChange(e.target.value as Empleado["rol"])}
      className={cn(
        "appearance-none rounded-full border-0 cursor-pointer py-1 pl-3 pr-7 text-xs font-medium min-w-[8rem] max-w-full",
        "focus:outline-none focus:ring-2 focus:ring-[var(--primary)] disabled:opacity-60 disabled:cursor-wait",
        getColorRol(rol),
      )}
      style={{
        backgroundImage: CHEVRON_BG,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 0.4rem center",
      }}
    >
      <option value="EMPLEADO">Empleado</option>
      <option value="MANAGER">Coordinador</option>
      <option value="OWNER">Administrador</option>
    </select>
  );
}

/**
 * Selector de manager con búsqueda y orden alfabético. A nivel de módulo
 * (evita la regla react-hooks/static-components).
 */
function ManagerCombobox({
  empleados,
  value,
  excludeId,
  onChange,
}: {
  empleados: Empleado[];
  value: string;
  excludeId?: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const candidatos = empleados
    .filter((e) => e.id !== excludeId && e.activo)
    .sort((a, b) =>
      `${a.nombre} ${a.apellidos}`.localeCompare(`${b.nombre} ${b.apellidos}`, "es"),
    );
  const filtrados = q
    ? candidatos.filter((e) =>
        `${e.nombre} ${e.apellidos}`.toLowerCase().includes(q.toLowerCase()),
      )
    : candidatos;
  const sel = candidatos.find((e) => e.id === value);
  return (
    <div className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <span className={cn("truncate", !sel && "text-slate-400")}>
          {sel ? `${sel.nombre} ${sel.apellidos}` : "Sin manager"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-full rounded-md border border-input bg-background shadow-lg">
            <div className="border-b border-slate-100 p-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar manager…"
                  className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); setQ(""); }}
                className="flex w-full items-center px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
              >
                Sin manager
              </button>
              {filtrados.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => { onChange(e.id); setOpen(false); setQ(""); }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50",
                    e.id === value && "bg-slate-50",
                  )}
                >
                  <span className="truncate">
                    {e.nombre} {e.apellidos}{" "}
                    <span className="text-xs text-slate-400">({e.rol})</span>
                  </span>
                  {e.id === value && <Check className="h-4 w-4 shrink-0 text-[var(--primary)]" />}
                </button>
              ))}
              {filtrados.length === 0 && (
                <p className="px-3 py-2 text-sm text-slate-400">Sin resultados</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Celda de sedes: muestra la principal + "+N" si el empleado está en varias. */
function SedesCelda({ emp }: { emp: Empleado }) {
  const sedes = emp.sedes ?? [];
  if (sedes.length === 0) {
    // Back-compat: si no hay UsuarioSede pero sí tiendaId/tienda.
    if (emp.tienda) {
      return (
        <span className="flex items-center gap-1.5 min-w-0" title={emp.tienda.nombre}>
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: emp.tienda.color }} />
          <span className="text-slate-600 truncate">{emp.tienda.nombre}</span>
        </span>
      );
    }
    return <span className="text-slate-400">Sin sede</span>;
  }
  const principal = sedes.find((s) => s.principal) ?? sedes[0];
  const extra = sedes.length - 1;
  const todas = sedes.map((s) => s.tienda.nombre).join(", ");
  return (
    <span className="flex items-center gap-1.5 min-w-0" title={todas}>
      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: principal.tienda.color }} />
      <span className="text-slate-600 truncate">{principal.tienda.nombre}</span>
      {extra > 0 && (
        <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
          +{extra}
        </span>
      )}
    </span>
  );
}

interface Tienda {
  id: string;
  nombre: string;
  color: string;
}

const FORM_INICIAL = {
  nombre: "", apellidos: "", email: "", dni: "", telefono: "",
  password: "", rol: "EMPLEADO" as "OWNER" | "MANAGER" | "EMPLEADO", tiendaId: "",
  // sedeIds = todas las sedes del empleado; tiendaId = la principal.
  sedeIds: [] as string[],
  managerId: "", horasSemanalesContrato: "", turnoOficinaPorDefecto: false,
};

// Password field only used when editing (to change existing password)

export default function EmpleadosPage() {
  const { toast } = useToast();
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  // Plantillas de documentos disponibles para enviar en el alta.
  const [plantillas, setPlantillas] = useState<{ id: string; nombre: string }[]>([]);
  const [plantillaIds, setPlantillaIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTienda, setFiltroTienda] = useState("todas");
  const [filtroRol, setFiltroRol] = useState("todos");
  const [rolGuardando, setRolGuardando] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("Empleado");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [confirmar, setConfirmar] = useState<{
    titulo: string;
    mensaje: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<Empleado | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [accionMasiva, setAccionMasiva] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [descargandoPlantilla, setDescargandoPlantilla] = useState(false);
  const [importando, setImportando] = useState(false);
  const [importResult, setImportResult] = useState<ResultadoImportacion | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, tiendasRes, plantillasRes] = await Promise.all([
        fetch("/api/empleados"),
        fetch("/api/tiendas"),
        fetch("/api/documentos/plantillas"),
      ]);
      const [empData, tiendasData, plantillasData] = await Promise.all([
        empRes.json(), tiendasRes.json(), plantillasRes.json().catch(() => ({})),
      ]);
      setEmpleados(empData.empleados || []);
      setTiendas(tiendasData.tiendas || []);
      setPlantillas((plantillasData.plantillas || []).map((p: { id: string; nombre: string }) => ({ id: p.id, nombre: p.nombre })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const empleadosFiltrados = empleados.filter((e) => {
    const matchSearch = busqueda
      ? `${e.nombre} ${e.apellidos} ${e.email} ${e.dni || ""}`.toLowerCase().includes(busqueda.toLowerCase())
      : true;
    const matchTienda = filtroTienda === "todas" ? true : e.tiendaId === filtroTienda;
    const matchRol = filtroRol === "todos" ? true : e.rol === filtroRol;
    return matchSearch && matchTienda && matchRol;
  });

  // Orden por columna (cabeceras clicables).
  const valorColumna = (e: Empleado, key: string): string => {
    switch (key) {
      case "Empleado": return `${e.nombre} ${e.apellidos}`.toLowerCase();
      case "Email": return (e.email || "").toLowerCase();
      case "DNI": return (e.dni || "").toLowerCase();
      case "Rol": return e.rol;
      case "Sede": {
        const s = e.sedes?.find((x) => x.principal) ?? e.sedes?.[0];
        return (s?.tienda.nombre ?? e.tienda?.nombre ?? "").toLowerCase();
      }
      case "Estado": return getEstadoEmpleado(e).label.toLowerCase();
      default: return "";
    }
  };
  const empleadosOrdenados = [...empleadosFiltrados].sort((a, b) => {
    const cmp = valorColumna(a, sortBy).localeCompare(valorColumna(b, sortBy), "es");
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("asc"); }
  };

  // Exporta el directorio de empleados a Excel/PDF. Respeta los filtros
  // estructurados (sede y rol); el buscador de texto libre es client-only.
  const handleExport = async (formato: "xlsx" | "pdf") => {
    setExportando(true);
    try {
      const params = new URLSearchParams({ formato });
      if (filtroTienda !== "todas") params.set("tiendaId", filtroTienda);
      if (filtroRol !== "todos") params.set("rol", filtroRol);
      const res = await fetch(`/api/empleados/exportar?${params}`);
      if (!res.ok) {
        if (res.status === 402 || res.status === 429) {
          const body = (await res.json()) as { error?: string; upgrade_url?: string };
          toast({
            title: body.error === "limit_reached" ? "Límite de exports alcanzado" : "Función no disponible en tu plan",
            description: body.upgrade_url ? "Actualiza tu plan para usar exportación." : undefined,
            variant: "destructive",
          });
          return;
        }
        throw new Error();
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `empleados_${new Date().toISOString().slice(0, 10)}.${formato}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Error al exportar", variant: "destructive" });
    } finally {
      setExportando(false);
    }
  };

  // Descarga la plantilla Excel (una fila por empleado con sus datos) para
  // editarla y volver a subirla desde "Importar".
  const handleDescargarPlantilla = async () => {
    setDescargandoPlantilla(true);
    try {
      const res = await fetch("/api/empleados/plantilla");
      if (!res.ok) {
        toast({ title: "No se pudo generar la plantilla", variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `plantilla_empleados_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Error al descargar la plantilla", variant: "destructive" });
    } finally {
      setDescargandoPlantilla(false);
    }
  };

  // Sube la plantilla editada. Solo actualiza empleados existentes (match
  // por email); una celda vacía deja el campo sin cambios.
  const handleImportar = async (file: File) => {
    setImportando(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/empleados/importar", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Error al importar", variant: "destructive" });
        return;
      }
      setImportResult(data as ResultadoImportacion);
      fetchData();
    } catch {
      toast({ title: "Error al importar el archivo", variant: "destructive" });
    } finally {
      setImportando(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const abrirCrear = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setPlantillaIds(new Set());
    setDialogOpen(true);
  };

  const abrirEditar = (emp: Empleado) => {
    setEditando(emp);
    setForm({
      nombre: emp.nombre, apellidos: emp.apellidos, email: emp.email,
      dni: emp.dni || "", telefono: emp.telefono || "", password: "",
      rol: emp.rol, tiendaId: emp.tiendaId || "",
      sedeIds: emp.sedes?.length
        ? emp.sedes.map((s) => s.tiendaId)
        : emp.tiendaId
          ? [emp.tiendaId]
          : [],
      managerId: (emp as { managerId?: string }).managerId || "",
      horasSemanalesContrato:
        emp.horasSemanalesContrato === null || emp.horasSemanalesContrato === undefined
          ? ""
          : String(emp.horasSemanalesContrato),
      turnoOficinaPorDefecto: emp.turnoOficinaPorDefecto ?? false,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.nombre || !form.apellidos || !form.email) {
      toast({ title: "Nombre, apellidos y email son obligatorios", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const body: any = { ...form };
      // When creating, don't send password — invite email is sent instead
      if (!editando) delete body.password;
      if (editando && !body.password) delete body.password;
      // Multi-sede: la principal (tiendaId) debe estar entre las sedes
      // elegidas; si no, se usa la primera. Vacío = sin sede.
      const sedeIds: string[] = Array.isArray(body.sedeIds) ? body.sedeIds : [];
      const principal = body.tiendaId && sedeIds.includes(body.tiendaId)
        ? body.tiendaId
        : (sedeIds[0] ?? null);
      body.tiendaId = principal;
      if (editando) {
        body.sedeIds = sedeIds; // la API sincroniza UsuarioSede (solo en PUT)
        delete body.plantillaIds;
      } else {
        delete body.sedeIds; // el alta (POST) solo asigna la sede principal
        // Plantillas de documentos a enviar como parte del alta.
        body.plantillaIds = [...plantillaIds];
      }
      // managerId vacío = quitar manager. "ninguno" del select también vacío.
      if (!body.managerId || body.managerId === "ninguno") body.managerId = null;
      // Horas de contrato: "" = null; resto número.
      body.horasSemanalesContrato =
        body.horasSemanalesContrato === "" || body.horasSemanalesContrato == null
          ? null
          : Number(body.horasSemanalesContrato);

      const url = editando ? `/api/empleados/${editando.id}` : "/api/empleados";
      const method = editando ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error");
      }
      toast({
        title: editando ? "Empleado actualizado" : "Empleado creado",
        description: editando ? undefined : "Se ha enviado un email de bienvenida para que establezca su contraseña",
      });
      setDialogOpen(false);
      fetchData();
    } catch (e: any) {
      toast({ title: e.message || "Error al guardar", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCambiarRol = async (emp: Empleado, nuevoRol: Empleado["rol"]) => {
    if (emp.rol === nuevoRol) return;
    const anterior = emp.rol;
    setRolGuardando(emp.id);
    // Optimista: refleja el cambio ya; revierte si falla.
    setEmpleados((prev) => prev.map((e) => (e.id === emp.id ? { ...e, rol: nuevoRol } : e)));
    try {
      const res = await fetch(`/api/empleados/${emp.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rol: nuevoRol }),
      });
      if (!res.ok) throw new Error();
      toast({
        title: "Rol actualizado",
        description: `${emp.nombre} ${emp.apellidos} → ${getLabelRol(nuevoRol)}`,
      });
    } catch {
      setEmpleados((prev) => prev.map((e) => (e.id === emp.id ? { ...e, rol: anterior } : e)));
      toast({ title: "No se pudo cambiar el rol", variant: "destructive" });
    } finally {
      setRolGuardando(null);
    }
  };

  const handleToggleActivo = async (emp: Empleado) => {
    try {
      const res = await fetch(`/api/empleados/${emp.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !emp.activo }),
      });
      if (!res.ok) throw new Error();
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const handleReenviarInvitacion = async (emp: Empleado) => {
    try {
      const res = await fetch(`/api/empleados/${emp.id}/reenviar-invitacion`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast({ title: "Invitación reenviada", description: `Se ha enviado un nuevo enlace a ${emp.email}` });
    } catch {
      toast({ title: "Error al reenviar", variant: "destructive" });
    }
  };

  const ejecutarEliminar = async (emp: Empleado) => {
    try {
      const res = await fetch(`/api/empleados/${emp.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error");
      }
      toast({ title: "Empleado eliminado" });
      fetchData();
    } catch (e: any) {
      toast({ title: e.message || "Error al eliminar", variant: "destructive" });
    }
  };

  const handleEliminar = (emp: Empleado) => {
    setConfirmar({
      titulo: "Eliminar empleado",
      mensaje: `¿Eliminar a ${emp.nombre} ${emp.apellidos}? Se borrarán sus datos personales y dejará de aparecer en la lista. Sus fichajes y nóminas se conservan por obligación legal, ya anonimizados. Esta acción no se puede deshacer.`,
      onConfirm: () => ejecutarEliminar(emp),
    });
  };

  // Envía el email de restablecimiento a un empleado que YA tiene
  // contraseña. Para los que aún no la tienen (invitación pendiente)
  // se usa handleReenviarInvitacion.
  const enviarReset = async (emp: Empleado): Promise<boolean> => {
    const url = emp.password
      ? `/api/empleados/${emp.id}/restablecer-password`
      : `/api/empleados/${emp.id}/reenviar-invitacion`;
    const res = await fetch(url, { method: "POST" });
    return res.ok;
  };

  const handleRestablecerPassword = async (emp: Empleado) => {
    try {
      const ok = await enviarReset(emp);
      if (!ok) throw new Error();
      toast({
        title: "Email enviado",
        description: `Se ha enviado un enlace para restablecer la contraseña a ${emp.email}`,
      });
    } catch {
      toast({ title: "Error al enviar el email", variant: "destructive" });
    }
  };

  // --- Selección múltiple + acciones masivas ---
  const idsFiltrados = empleadosFiltrados.map((e) => e.id);
  const todosSeleccionados = idsFiltrados.length > 0 && idsFiltrados.every((id) => seleccionados.has(id));

  const toggleSeleccion = (id: string) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSeleccionarTodos = () => {
    setSeleccionados((prev) => {
      if (idsFiltrados.every((id) => prev.has(id))) {
        const next = new Set(prev);
        idsFiltrados.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...idsFiltrados]);
    });
  };

  const limpiarSeleccion = () => setSeleccionados(new Set());

  const empleadosSeleccionados = empleados.filter((e) => seleccionados.has(e.id));

  const bulkRestablecer = async () => {
    setAccionMasiva(true);
    try {
      const results = await Promise.allSettled(empleadosSeleccionados.map((e) => enviarReset(e)));
      const ok = results.filter((r) => r.status === "fulfilled" && r.value).length;
      const fail = empleadosSeleccionados.length - ok;
      toast({
        title: `${ok} email${ok === 1 ? "" : "s"} enviado${ok === 1 ? "" : "s"}`,
        description: fail > 0 ? `${fail} no se pudieron enviar` : undefined,
        variant: fail > 0 ? "destructive" : undefined,
      });
      limpiarSeleccion();
    } finally {
      setAccionMasiva(false);
    }
  };

  const bulkSetActivo = async (activo: boolean) => {
    setAccionMasiva(true);
    try {
      await Promise.allSettled(
        empleadosSeleccionados.map((e) =>
          fetch(`/api/empleados/${e.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activo }),
          }),
        ),
      );
      toast({ title: activo ? "Empleados activados" : "Empleados desactivados" });
      limpiarSeleccion();
      fetchData();
    } finally {
      setAccionMasiva(false);
    }
  };

  const ejecutarBulkEliminar = async () => {
    setAccionMasiva(true);
    try {
      const results = await Promise.allSettled(
        empleadosSeleccionados.map((e) => fetch(`/api/empleados/${e.id}`, { method: "DELETE" })),
      );
      const ok = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
      const fail = empleadosSeleccionados.length - ok;
      toast({
        title: `${ok} empleado(s) eliminado(s)`,
        description: fail > 0 ? `${fail} no se pudieron eliminar` : undefined,
        variant: fail > 0 ? "destructive" : undefined,
      });
      limpiarSeleccion();
      fetchData();
    } finally {
      setAccionMasiva(false);
    }
  };

  const bulkEliminar = () => {
    setConfirmar({
      titulo: "Eliminar empleados",
      mensaje: `¿Eliminar ${empleadosSeleccionados.length} empleado(s)? Se borrarán sus datos personales y dejarán de aparecer en la lista. Sus fichajes y nóminas se conservan por obligación legal, ya anonimizados. Esta acción no se puede deshacer.`,
      onConfirm: ejecutarBulkEliminar,
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Empleados</h1>
          <p className="text-slate-500 text-sm mt-1">{empleados.length} empleados registrados</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <FeatureGateClient feature="export_excel">
            <Button variant="outline" disabled={exportando} onClick={() => handleExport("xlsx")}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
            </Button>
          </FeatureGateClient>
          <FeatureGateClient feature="export_pdf">
            <Button variant="outline" disabled={exportando} onClick={() => handleExport("pdf")}>
              <FileText className="h-4 w-4 mr-2" /> PDF
            </Button>
          </FeatureGateClient>
          <Button variant="outline" disabled={descargandoPlantilla} onClick={handleDescargarPlantilla} title="Descargar una plantilla Excel para editar los datos en bloque">
            {descargandoPlantilla ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />} Plantilla
          </Button>
          <Button variant="outline" disabled={importando} onClick={() => fileInputRef.current?.click()} title="Subir la plantilla editada para actualizar empleados en bloque">
            {importando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />} Importar
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportar(f);
            }}
          />
          <Button onClick={abrirCrear}>
            <Plus className="h-4 w-4 mr-2" /> Nuevo Empleado
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Buscar por nombre, email, DNI..."
            className="pl-9"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <Select value={filtroTienda} onValueChange={setFiltroTienda}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Todas las tiendas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las sedes</SelectItem>
            {tiendas.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroRol} onValueChange={setFiltroRol}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue placeholder="Todos los roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los roles</SelectItem>
            <SelectItem value="EMPLEADO">Empleado</SelectItem>
            <SelectItem value="MANAGER">Coordinador</SelectItem>
            <SelectItem value="OWNER">Administrador</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Barra de acciones masivas */}
      {seleccionados.size > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5 px-4 py-2.5">
          <span className="text-sm font-medium text-slate-700">
            {seleccionados.size} seleccionado{seleccionados.size === 1 ? "" : "s"}
          </span>
          <span className="h-4 w-px bg-slate-300 mx-1" />
          <Button variant="outline" size="sm" disabled={accionMasiva} onClick={bulkRestablecer}>
            <KeyRound className="h-3.5 w-3.5 mr-1.5" /> Restablecer contraseña
          </Button>
          <Button variant="outline" size="sm" disabled={accionMasiva} onClick={() => bulkSetActivo(true)}>
            <UserCheck className="h-3.5 w-3.5 mr-1.5 text-emerald-500" /> Activar
          </Button>
          <Button variant="outline" size="sm" disabled={accionMasiva} onClick={() => bulkSetActivo(false)}>
            <UserX className="h-3.5 w-3.5 mr-1.5 text-amber-500" /> Desactivar
          </Button>
          <Button variant="outline" size="sm" disabled={accionMasiva} onClick={bulkEliminar} className="hover:bg-red-50 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5 mr-1.5 text-red-400" /> Eliminar
          </Button>
          <Button variant="ghost" size="sm" onClick={limpiarSeleccion} className="ml-auto">
            <X className="h-3.5 w-3.5 mr-1.5" /> Limpiar
          </Button>
        </div>
      )}

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />)}
            </div>
          ) : empleadosFiltrados.length === 0 ? (
            <div className="py-12 text-center text-slate-400">No se encontraron empleados</div>
          ) : (
            <>
            <div className="hidden md:block overflow-x-auto">
              {/*
                Anchos como proporciones (table-fixed + w-full): con la barra
                lateral (256px en lg+) el área útil de un portátil ronda los
                ~960-1136px, así que la tabla se dimensiona para caber ahí sin
                scroll horizontal y crece proporcionalmente en pantallas
                grandes. `min-w-[960px]` es solo el suelo antes de activar el
                overflow. Suma = 960; celdas con `truncate` absorben el resto.
              */}
              <table className="w-full table-fixed min-w-[960px]">
                <colgroup>
                  <col style={{ width: 40 }} />
                  <col style={{ width: 150 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 88 }} />
                  <col style={{ width: 152 }} />
                  <col style={{ width: 84 }} />
                  <col style={{ width: 164 }} />
                  <col style={{ width: 172 }} />
                </colgroup>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-3 w-10">
                      <input
                        type="checkbox"
                        aria-label="Seleccionar todos"
                        className="h-4 w-4 rounded border-slate-300 accent-[var(--primary)] cursor-pointer align-middle"
                        checked={todosSeleccionados}
                        onChange={toggleSeleccionarTodos}
                      />
                    </th>
                    {["Empleado", "Email", "DNI", "Rol", "Sede", "Estado", "Acciones"].map((h) => {
                      const ordenable = h !== "Acciones";
                      return (
                        <th
                          key={h}
                          onClick={ordenable ? () => toggleSort(h) : undefined}
                          className={cn(
                            "text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-3 py-3",
                            ordenable && "cursor-pointer select-none hover:text-slate-700",
                          )}
                        >
                          <span className="inline-flex items-center gap-1">
                            {h}
                            {sortBy === h && (
                              sortDir === "asc"
                                ? <ChevronUp className="h-3 w-3" />
                                : <ChevronDown className="h-3 w-3" />
                            )}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 [&>tr>td]:align-middle">
                  {empleadosOrdenados.map((emp) => {
                    const estado = getEstadoEmpleado(emp);
                    return (
                      <tr key={emp.id} className={cn("hover:bg-slate-50 transition-colors", !emp.activo && "opacity-60", seleccionados.has(emp.id) && "bg-[var(--primary)]/5")}>
                        <td className="px-3 py-3 w-10">
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar ${emp.nombre} ${emp.apellidos}`}
                            className="h-4 w-4 rounded border-slate-300 accent-[var(--primary)] cursor-pointer align-middle"
                            checked={seleccionados.has(emp.id)}
                            onChange={() => toggleSeleccion(emp.id)}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <EmployeeAvatar nombre={emp.nombre} apellidos={emp.apellidos} seed={emp.id} />
                            <span
                              className="font-medium text-slate-900 text-sm leading-tight truncate"
                              title={`${emp.nombre} ${emp.apellidos}`}
                            >
                              {emp.nombre} {emp.apellidos}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600 truncate" title={emp.email}>{emp.email}</td>
                        <td className="px-3 py-3 text-sm text-slate-600 truncate" title={emp.dni || undefined}>{emp.dni || "—"}</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <RolSelectInline
                            rol={emp.rol}
                            disabled={rolGuardando === emp.id}
                            onChange={(nuevoRol) => handleCambiarRol(emp, nuevoRol)}
                          />
                        </td>
                        <td className="px-3 py-3 text-sm">
                          <SedesCelda emp={emp} />
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <StatusPill tone={estado.tone} label={estado.label} showDot={false} />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex gap-0.5">
                            <Link href={`/admin/empleados/${emp.id}`}>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver ficha completa">
                                <FileText className="h-3.5 w-3.5 text-slate-500" />
                              </Button>
                            </Link>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditar(emp)} title="Editar">
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            {emp.password && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleRestablecerPassword(emp)}
                                title="Enviar restablecimiento de contraseña"
                              >
                                <KeyRound className="h-3.5 w-3.5 text-amber-500" />
                              </Button>
                            )}
                            {!emp.password ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleReenviarInvitacion(emp)}
                                title="Reenviar invitación"
                              >
                                <Send className="h-3.5 w-3.5 text-[var(--primary)]" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleToggleActivo(emp)}
                                title={emp.activo ? "Desactivar" : "Activar"}
                              >
                                {emp.activo
                                  ? <UserX className="h-3.5 w-3.5 text-amber-500" />
                                  : <UserCheck className="h-3.5 w-3.5 text-emerald-500" />
                                }
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:bg-red-50"
                              onClick={() => handleEliminar(emp)}
                              title="Eliminar empleado"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-400" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Vista de tarjetas (móvil) */}
            <div className="md:hidden space-y-3 p-4">
              {empleadosOrdenados.map((emp) => {
                const estado = getEstadoEmpleado(emp);
                return (
                  <div
                    key={emp.id}
                    className={cn(
                      "rounded-lg border border-slate-200 bg-white p-4",
                      !emp.activo && "opacity-60",
                      seleccionados.has(emp.id) && "border-[var(--primary)]/40 bg-[var(--primary)]/5",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${emp.nombre} ${emp.apellidos}`}
                        className="h-4 w-4 mt-1 rounded border-slate-300 accent-[var(--primary)] cursor-pointer shrink-0"
                        checked={seleccionados.has(emp.id)}
                        onChange={() => toggleSeleccion(emp.id)}
                      />
                      <EmployeeAvatar nombre={emp.nombre} apellidos={emp.apellidos} seed={emp.id} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 text-sm truncate">
                          {emp.nombre} {emp.apellidos}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{emp.email}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <RolSelectInline
                        rol={emp.rol}
                        disabled={rolGuardando === emp.id}
                        onChange={(nuevoRol) => handleCambiarRol(emp, nuevoRol)}
                      />
                      <StatusPill tone={estado.tone} label={estado.label} showDot={false} />
                      <span className="text-xs max-w-[160px]">
                        <SedesCelda emp={emp} />
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1 border-t border-slate-100 pt-3">
                      <Link href={`/admin/empleados/${emp.id}`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Ver ficha completa">
                          <FileText className="h-4 w-4 text-slate-500" />
                        </Button>
                      </Link>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEditar(emp)} title="Editar">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      {emp.password && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleRestablecerPassword(emp)}
                          title="Enviar restablecimiento de contraseña"
                        >
                          <KeyRound className="h-4 w-4 text-amber-500" />
                        </Button>
                      )}
                      {!emp.password ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleReenviarInvitacion(emp)}
                          title="Reenviar invitación"
                        >
                          <Send className="h-4 w-4 text-[var(--primary)]" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleToggleActivo(emp)}
                          title={emp.activo ? "Desactivar" : "Activar"}
                        >
                          {emp.activo
                            ? <UserX className="h-4 w-4 text-amber-500" />
                            : <UserCheck className="h-4 w-4 text-emerald-500" />
                          }
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-red-50"
                        onClick={() => handleEliminar(emp)}
                        title="Eliminar empleado"
                      >
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Empleado" : "Nuevo Empleado"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nombre *</Label>
                <Input className="mt-1" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
              </div>
              <div>
                <Label>Apellidos *</Label>
                <Input className="mt-1" value={form.apellidos} onChange={(e) => setForm((f) => ({ ...f, apellidos: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label>Email *</Label>
                <Input className="mt-1" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <Label>DNI</Label>
                <Input className="mt-1" value={form.dni} onChange={(e) => setForm((f) => ({ ...f, dni: e.target.value }))} />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input className="mt-1" value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} />
              </div>
              {editando && (
                <div>
                  <Label>Nueva contraseña <span className="text-slate-400 font-normal">(vacío = no cambiar)</span></Label>
                  <Input className="mt-1" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
                </div>
              )}
              <div>
                <Label>Rol</Label>
                <Select value={form.rol} onValueChange={(v) => setForm((f) => ({ ...f, rol: v as any }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMPLEADO">Empleado</SelectItem>
                    <SelectItem value="MANAGER">Coordinador</SelectItem>
                    <SelectItem value="OWNER">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Sedes asignadas</Label>
                <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-input divide-y divide-slate-100">
                  {tiendas.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-400">No hay sedes creadas</p>
                  ) : (
                    tiendas.map((t) => {
                      const checked = form.sedeIds.includes(t.id);
                      const esPrincipal = form.tiendaId === t.id;
                      return (
                        <div key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 accent-[var(--primary)] cursor-pointer shrink-0"
                            checked={checked}
                            onChange={(e) =>
                              setForm((f) => {
                                const set = new Set(f.sedeIds);
                                if (e.target.checked) set.add(t.id);
                                else set.delete(t.id);
                                const sedeIds = [...set];
                                let tiendaId = f.tiendaId;
                                if (!sedeIds.includes(tiendaId)) tiendaId = sedeIds[0] ?? "";
                                if (e.target.checked && !tiendaId) tiendaId = t.id;
                                return { ...f, sedeIds, tiendaId };
                              })
                            }
                          />
                          <span className="flex flex-1 items-center gap-1.5 min-w-0">
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                            <span className="truncate">{t.nombre}</span>
                          </span>
                          {checked && (
                            <button
                              type="button"
                              onClick={() => setForm((f) => ({ ...f, tiendaId: t.id }))}
                              className={cn(
                                "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
                                esPrincipal
                                  ? "bg-[var(--primary)] text-white"
                                  : "text-slate-500 hover:bg-slate-100",
                              )}
                              title="Marcar como sede principal"
                            >
                              {esPrincipal ? "Principal" : "Hacer principal"}
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Marca varias sedes; la principal es la que se usa por defecto al fichar.
                  {!editando && " (Al crear se asigna solo la principal.)"}
                </p>
              </div>
              <div className="col-span-2">
                <Label>Horas semanales de contrato <span className="text-slate-400 font-normal">(opcional)</span></Label>
                <Input
                  className="mt-1"
                  type="number"
                  min={0}
                  max={168}
                  step={0.5}
                  placeholder="Ej: 38"
                  value={form.horasSemanalesContrato}
                  onChange={(e) => setForm((f) => ({ ...f, horasSemanalesContrato: e.target.value }))}
                />
              </div>
              <div className="col-span-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--primary)]"
                    checked={form.turnoOficinaPorDefecto}
                    onChange={(e) => setForm((f) => ({ ...f, turnoOficinaPorDefecto: e.target.checked }))}
                  />
                  <span className="text-sm font-medium text-slate-800">Horario de oficina por defecto</span>
                </label>
                <p className="mt-1 text-xs text-slate-400">
                  En el cuadrante, los días que no tenga turno en ninguna tienda se rellenan solos con
                  un turno de 9:00 a 17:00 en la sede marcada como oficina.
                </p>
              </div>
              <div className="col-span-2">
                <Label>Manager (responsable directo)</Label>
                <ManagerCombobox
                  empleados={empleados}
                  value={form.managerId}
                  excludeId={editando?.id}
                  onChange={(id) => setForm((f) => ({ ...f, managerId: id }))}
                />
              </div>
              {!editando && plantillas.length > 0 && (
                <div className="col-span-2">
                  <Label>Enviar plantillas en el alta <span className="text-slate-400 font-normal">(opcional)</span></Label>
                  <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-input divide-y divide-slate-100">
                    {plantillas.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 accent-[var(--primary)] cursor-pointer shrink-0"
                          checked={plantillaIds.has(p.id)}
                          onChange={() =>
                            setPlantillaIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                              return next;
                            })
                          }
                        />
                        <span className="truncate">{p.nombre}</span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Los documentos de estas plantillas se enviarán al nuevo empleado al crearlo.
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Guardando..." : editando ? "Actualizar" : "Crear Empleado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación de borrado (reemplaza al confirm() nativo) */}
      <Dialog open={confirmar !== null} onOpenChange={(o) => { if (!o && !confirmando) setConfirmar(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-100 shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </span>
              {confirmar?.titulo}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">{confirmar?.mensaje}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmar(null)} disabled={confirmando}>
              Cancelar
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={confirmando}
              onClick={async () => {
                if (!confirmar) return;
                setConfirmando(true);
                try {
                  await confirmar.onConfirm();
                } finally {
                  setConfirmando(false);
                  setConfirmar(null);
                }
              }}
            >
              {confirmando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resultado de la importación masiva */}
      <Dialog open={importResult !== null} onOpenChange={(o) => { if (!o) setImportResult(null); }}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resultado de la importación</DialogTitle>
          </DialogHeader>
          {importResult && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{importResult.actualizadas} actualizados</Badge>
                <Badge variant="outline">{importResult.sinCambios} sin cambios</Badge>
                {importResult.errores.length > 0 && (
                  <Badge variant="destructive">{importResult.errores.length} con errores</Badge>
                )}
              </div>
              <p className="text-slate-500">
                Se procesaron {importResult.totalFilas} fila{importResult.totalFilas === 1 ? "" : "s"} de la plantilla.
              </p>
              {importResult.errores.length > 0 && (
                <div className="rounded-md border border-red-100 bg-red-50/50 p-3">
                  <p className="font-medium text-red-700 mb-1">Filas no aplicadas</p>
                  <ul className="space-y-1 text-slate-600">
                    {importResult.errores.slice(0, 50).map((e, i) => (
                      <li key={i}>
                        <span className="font-medium">Fila {e.fila}</span>
                        {e.email ? ` (${e.email})` : ""}: {e.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setImportResult(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
