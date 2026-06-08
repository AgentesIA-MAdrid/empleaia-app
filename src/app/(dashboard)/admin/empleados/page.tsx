"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, Search, Edit2, UserX, UserCheck, Trash2, Send, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  horasSemanalesContrato?: number | string | null;
}

function getEstadoEmpleado(emp: Empleado): { label: string; tone: "warning" | "neutral" | "success" } {
  if (!emp.password) return { label: "Invitación pendiente", tone: "warning" };
  if (!emp.activo) return { label: "Inactivo", tone: "neutral" };
  return { label: "Activo", tone: "success" };
}

interface Tienda {
  id: string;
  nombre: string;
  color: string;
}

const FORM_INICIAL = {
  nombre: "", apellidos: "", email: "", dni: "", telefono: "",
  password: "", rol: "EMPLEADO" as "OWNER" | "MANAGER" | "EMPLEADO", tiendaId: "",
  managerId: "", horasSemanalesContrato: "",
};

// Password field only used when editing (to change existing password)

export default function EmpleadosPage() {
  const { toast } = useToast();
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTienda, setFiltroTienda] = useState("todas");
  const [filtroRol, setFiltroRol] = useState("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<Empleado | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, tiendasRes] = await Promise.all([
        fetch("/api/empleados"),
        fetch("/api/tiendas"),
      ]);
      const [empData, tiendasData] = await Promise.all([empRes.json(), tiendasRes.json()]);
      setEmpleados(empData.empleados || []);
      setTiendas(tiendasData.tiendas || []);
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

  const abrirCrear = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setDialogOpen(true);
  };

  const abrirEditar = (emp: Empleado) => {
    setEditando(emp);
    setForm({
      nombre: emp.nombre, apellidos: emp.apellidos, email: emp.email,
      dni: emp.dni || "", telefono: emp.telefono || "", password: "",
      rol: emp.rol, tiendaId: emp.tiendaId || "",
      managerId: (emp as { managerId?: string }).managerId || "",
      horasSemanalesContrato:
        emp.horasSemanalesContrato === null || emp.horasSemanalesContrato === undefined
          ? ""
          : String(emp.horasSemanalesContrato),
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
      if (!body.tiendaId) body.tiendaId = null;
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

  const handleEliminar = async (emp: Empleado) => {
    if (!confirm(`¿Eliminar permanentemente a ${emp.nombre} ${emp.apellidos}? Esta acción no se puede deshacer.`)) return;
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Empleados</h1>
          <p className="text-slate-500 text-sm mt-1">{empleados.length} empleados registrados</p>
        </div>
        <Button onClick={abrirCrear}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo Empleado
        </Button>
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
          <SelectTrigger className="w-44">
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
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Todos los roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los roles</SelectItem>
            <SelectItem value="EMPLEADO">Empleado</SelectItem>
            <SelectItem value="MANAGER">Manager</SelectItem>
            <SelectItem value="OWNER">Administrador</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Empleado", "Email", "DNI", "Rol", "Sede", "Estado", "Acciones"].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {empleadosFiltrados.map((emp) => {
                    const estado = getEstadoEmpleado(emp);
                    return (
                      <tr key={emp.id} className={cn("hover:bg-slate-50 transition-colors", !emp.activo && "opacity-60")}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <EmployeeAvatar nombre={emp.nombre} apellidos={emp.apellidos} seed={emp.id} />
                            <span className="font-medium text-slate-900 text-sm">
                              {emp.nombre} {emp.apellidos}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">{emp.email}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{emp.dni || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", getColorRol(emp.rol))}>
                            {getLabelRol(emp.rol)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {emp.tienda ? (
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: emp.tienda.color }} />
                              <span className="text-slate-600 truncate max-w-[120px]">{emp.tienda.nombre}</span>
                            </span>
                          ) : <span className="text-slate-400">Sin sede</span>}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill tone={estado.tone} label={estado.label} showDot={false} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <Link href={`/admin/empleados/${emp.id}`}>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver ficha completa">
                                <FileText className="h-3.5 w-3.5 text-slate-500" />
                              </Button>
                            </Link>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditar(emp)} title="Editar">
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
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
          )}
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
                    <SelectItem value="MANAGER">Manager</SelectItem>
                    <SelectItem value="OWNER">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Sede asignada</Label>
                <Select value={form.tiendaId || "ninguna"} onValueChange={(v) => setForm((f) => ({ ...f, tiendaId: v === "ninguna" ? "" : v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Sin sede" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ninguna">Sin sede</SelectItem>
                    {tiendas.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <div className="col-span-2">
                <Label>Manager (responsable directo)</Label>
                <Select
                  value={form.managerId || "ninguno"}
                  onValueChange={(v) => setForm((f) => ({ ...f, managerId: v === "ninguno" ? "" : v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Sin manager" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ninguno">Sin manager</SelectItem>
                    {empleados
                      .filter((e) => e.id !== editando?.id && e.activo)
                      .map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.nombre} {e.apellidos}{" "}
                          <span className="text-xs text-slate-400">({e.rol})</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
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
    </div>
  );
}
