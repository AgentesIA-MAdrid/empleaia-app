"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Edit2, MapPin, Phone, Mail, Users, ToggleLeft, ToggleRight, LocateFixed, Clock, UserCog, ChevronDown, Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { SedeHorariosDialog } from "@/components/admin/sede-horarios-dialog";
import { SedeEmpleadosDialog } from "@/components/admin/sede-empleados-dialog";

interface Tienda {
  id: string;
  nombre: string;
  direccion: string;
  ciudad: string;
  codigoPostal?: string;
  telefono?: string;
  email?: string;
  latitud?: number;
  longitud?: number;
  radio: number;
  activa: boolean;
  color: string;
  // Marca la sede que hace de oficina (destino del relleno automático del
  // cuadrante). Solo una sede puede tenerlo activo.
  esOficina?: boolean;
  sinEfectivo?: boolean;
  arqueoDiaSemana?: number;
  codigoExterno?: string | null;
  exigirFichajeEnSede?: boolean;
  // Responsable de la sede (dato informativo). Null si no se ha asignado.
  managerId?: string | null;
  manager?: { id: string; nombre: string; apellidos: string } | null;
  _count?: { empleados: number };
}

// Empleado en su forma reducida, para el selector de responsable de sede.
interface EmpleadoLite {
  id: string;
  nombre: string;
  apellidos: string;
  rol: "OWNER" | "MANAGER" | "EMPLEADO";
  activo: boolean;
}

/**
 * Selector de responsable de la sede con búsqueda. Solo OWNER/MANAGER son
 * candidatos (el responsable es informativo; no cambia aprobaciones). A
 * nivel de módulo, imitando `ManagerCombobox` de admin/empleados.
 */
function SedeManagerCombobox({
  empleados,
  value,
  onChange,
}: {
  empleados: EmpleadoLite[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const candidatos = empleados
    .filter((e) => e.activo && (e.rol === "OWNER" || e.rol === "MANAGER"))
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
          {sel ? `${sel.nombre} ${sel.apellidos}` : "Sin responsable"}
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
                  placeholder="Buscar responsable…"
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
                Sin responsable
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

const COLORES = [
  "#6366f1", "#8b5cf6", "#a78bfa", "#06b6d4", "#0ea5e9",
  "#f59e0b", "#ef4444", "#10b981", "#f97316", "#ec4899",
];

const FORM_INICIAL = {
  nombre: "", direccion: "", ciudad: "", codigoPostal: "", telefono: "",
  email: "", latitud: "", longitud: "", radio: "200", color: "#6366f1",
  managerId: "", esOficina: false, sinEfectivo: false, arqueoDiaSemana: 7, codigoExterno: "", exigirFichajeEnSede: false,
};

export default function TiendasPage() {
  const { toast } = useToast();
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<Tienda | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);
  const [horariosTienda, setHorariosTienda] = useState<{ id: string; nombre: string } | null>(null);
  const [empleadosTienda, setEmpleadosTienda] = useState<{ id: string; nombre: string } | null>(null);
  const [filtro, setFiltro] = useState<"activas" | "inactivas" | "todas">("activas");

  const ubicar = async () => {
    if (!form.direccion || !form.ciudad) {
      toast({ title: "Indica dirección y ciudad para ubicar", variant: "destructive" });
      return;
    }
    setGeocoding(true);
    try {
      const params = new URLSearchParams({
        direccion: form.direccion,
        ciudad: form.ciudad,
        cp: form.codigoPostal,
      });
      const res = await fetch(`/api/tiendas/geocodificar?${params.toString()}`);
      if (!res.ok) {
        toast({ title: "No se pudo ubicar la dirección", description: "Revísala o introduce las coordenadas a mano.", variant: "destructive" });
        return;
      }
      const data = await res.json();
      setForm((f) => ({ ...f, latitud: String(data.latitud), longitud: String(data.longitud) }));
      toast({ title: "Ubicación encontrada", description: "Revisa que el punto sea correcto." });
    } catch {
      toast({ title: "Error al ubicar", variant: "destructive" });
    } finally {
      setGeocoding(false);
    }
  };

  const fetchTiendas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tiendas");
      const data = await res.json();
      setTiendas(data.tiendas || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTiendas(); }, [fetchTiendas]);

  // Candidatos a responsable de sede (OWNER/MANAGER). El filtrado por rol lo
  // hace el combobox; aquí solo cargamos la plantilla activa una vez.
  useEffect(() => {
    fetch("/api/empleados?activo=true")
      .then((r) => r.json())
      .then((d) => setEmpleados(d.empleados ?? []))
      .catch(() => setEmpleados([]));
  }, []);

  const abrirCrear = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setDialogOpen(true);
  };

  const abrirEditar = (t: Tienda) => {
    setEditando(t);
    setForm({
      nombre: t.nombre, direccion: t.direccion, ciudad: t.ciudad,
      codigoPostal: t.codigoPostal || "", telefono: t.telefono || "",
      email: t.email || "", latitud: t.latitud?.toString() || "",
      longitud: t.longitud?.toString() || "", radio: t.radio.toString(),
      color: t.color, managerId: t.managerId || "", esOficina: t.esOficina ?? false,
      sinEfectivo: t.sinEfectivo ?? false,
      arqueoDiaSemana: t.arqueoDiaSemana ?? 7,
      codigoExterno: t.codigoExterno ?? "",
      exigirFichajeEnSede: t.exigirFichajeEnSede ?? false,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.nombre || !form.direccion || !form.ciudad) {
      toast({ title: "Nombre, dirección y ciudad son obligatorios", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        ...form,
        latitud: form.latitud ? parseFloat(form.latitud) : null,
        longitud: form.longitud ? parseFloat(form.longitud) : null,
        radio: parseInt(form.radio) || 200,
        exigirFichajeEnSede: form.exigirFichajeEnSede,
      };
      const url = editando ? `/api/tiendas/${editando.id}` : "/api/tiendas";
      const method = editando ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast({ title: editando ? "Sede actualizada" : "Sede creada" });
      setDialogOpen(false);
      fetchTiendas();
    } catch {
      toast({ title: "Error al guardar", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActiva = async (t: Tienda) => {
    try {
      await fetch(`/api/tiendas/${t.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activa: !t.activa }),
      });
      fetchTiendas();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const activas = tiendas.filter((t) => t.activa);
  const inactivas = tiendas.filter((t) => !t.activa);
  const tiendasFiltradas =
    filtro === "activas" ? activas : filtro === "inactivas" ? inactivas : tiendas;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sedes</h1>
          <p className="text-slate-500 text-sm mt-1">{tiendas.length} sedes configuradas</p>
        </div>
        <Button onClick={abrirCrear}>
          <Plus className="h-4 w-4 mr-2" /> Nueva Sede
        </Button>
      </div>

      <Tabs value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
        <TabsList>
          <TabsTrigger value="activas">Activas ({activas.length})</TabsTrigger>
          <TabsTrigger value="inactivas">Desactivadas ({inactivas.length})</TabsTrigger>
          <TabsTrigger value="todas">Todas ({tiendas.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : tiendasFiltradas.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          {filtro === "activas"
            ? "No hay sedes activas."
            : filtro === "inactivas"
              ? "No hay sedes desactivadas."
              : "No hay sedes. Crea una sede para empezar."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tiendasFiltradas.map((t) => (
            <Card key={t.id} className={cn(!t.activa && "opacity-60")}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: t.color }} />
                    <h3 className="font-semibold text-slate-900 text-sm">{t.nombre}</h3>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setHorariosTienda({ id: t.id, nombre: t.nombre })} title="Horarios de apertura">
                      <Clock className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEmpleadosTienda({ id: t.id, nombre: t.nombre })} title="Asignar empleados">
                      <Users className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditar(t)} title="Editar sede">
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <button onClick={() => handleToggleActiva(t)} className="text-slate-400 hover:text-slate-600" title={t.activa ? "Desactivar" : "Activar"}>
                      {t.activa
                        ? <ToggleRight className="h-5 w-5 text-emerald-500" />
                        : <ToggleLeft className="h-5 w-5" />
                      }
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 text-sm text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                    <span className="truncate">{t.direccion}, {t.ciudad}</span>
                  </div>
                  {t.telefono && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-slate-400" />
                      <span>{t.telefono}</span>
                    </div>
                  )}
                  {t.email && (
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-slate-400" />
                      <span className="truncate">{t.email}</span>
                    </div>
                  )}
                  {t.manager && (
                    <div className="flex items-center gap-1.5">
                      <UserCog className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                      <span className="truncate">{t.manager.nombre} {t.manager.apellidos}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {t._count?.empleados || 0} empleados
                  </span>
                  <span>Radio: {t.radio}m</span>
                  {!t.activa && <span className="text-red-500 font-medium">Inactiva</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Sede" : "Nueva Sede"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Nombre *</Label>
                <Input className="mt-1" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Sede Madrid Centro" />
              </div>
              <div className="col-span-2">
                <Label>Dirección *</Label>
                <Input className="mt-1" value={form.direccion} onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))} placeholder="Calle Gran Vía 1" />
              </div>
              <div>
                <Label>Ciudad *</Label>
                <Input className="mt-1" value={form.ciudad} onChange={(e) => setForm((f) => ({ ...f, ciudad: e.target.value }))} placeholder="Madrid" />
              </div>
              <div>
                <Label>Código Postal</Label>
                <Input className="mt-1" value={form.codigoPostal} onChange={(e) => setForm((f) => ({ ...f, codigoPostal: e.target.value }))} placeholder="28013" />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input className="mt-1" value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} placeholder="91 000 0000" />
              </div>
              <div>
                <Label>Email</Label>
                <Input className="mt-1" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="sede@empresa.es" />
              </div>
              <div className="col-span-2">
                <Label>Responsable de la sede</Label>
                <SedeManagerCombobox
                  empleados={empleados}
                  value={form.managerId}
                  onChange={(id) => setForm((f) => ({ ...f, managerId: id }))}
                />
                <p className="mt-1 text-xs text-slate-400">
                  Solo informativo: quién está al frente de esta sede. No cambia quién aprueba fichajes.
                </p>
              </div>
              <div className="col-span-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--primary)]"
                    checked={form.esOficina}
                    onChange={(e) => setForm((f) => ({ ...f, esOficina: e.target.checked }))}
                  />
                  <span className="text-sm font-medium text-slate-800">Esta sede es la oficina</span>
                </label>
                <p className="mt-1 text-xs text-slate-400">
                  Los empleados con “horario de oficina por defecto” cubrirán aquí (9:00–17:00) los días
                  que no tengan turno en ninguna tienda. Solo una sede puede ser la oficina.
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  En la oficina no se cierra turno ni se firman los puntos de control al fichar, sea
                  quien sea: es trabajo de oficina, no de tienda, y ahí no hay caja que cuadrar ni
                  stock que revisar.
                </p>
              </div>
              <div className="col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--primary)]"
                    checked={form.sinEfectivo}
                    onChange={(e) => setForm((f) => ({ ...f, sinEfectivo: e.target.checked }))}
                  />
                  <span className="text-sm font-medium text-slate-800">
                    El dinero de esta sede lo liquida un tercero
                  </span>
                </label>
                <p className="mt-1 text-xs text-slate-400">
                  Para un córner que cobra el propio centro y nos liquida después. Su equipo registra
                  las ventas igual que el resto, pero el cierre no pide efectivo ni tarjeta: pide el
                  stock y los tickets de las ventas facturadas. Queda fuera de arqueos y de la
                  conciliación bancaria.
                </p>
              </div>
              {/* El arqueo lo hace quien cierra la tienda el último día que
                  abre, y ese día no es el mismo en todas: las de centro
                  comercial abren el domingo; las de calle cierran el sábado y el
                  domingo no hay nadie que cuente el dinero (ticket 2c9d84f1). */}
              {!form.sinEfectivo && !form.esOficina && (
                <div className="col-span-2">
                  <label
                    htmlFor="arqueo-dia"
                    className="text-sm font-medium text-slate-800 block mb-1"
                  >
                    Día del arqueo semanal
                  </label>
                  <select
                    id="arqueo-dia"
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                    value={form.arqueoDiaSemana}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, arqueoDiaSemana: Number(e.target.value) }))
                    }
                  >
                    <option value={7}>Domingo (la tienda abre los domingos)</option>
                    <option value={6}>Sábado (la tienda no abre los domingos)</option>
                    <option value={5}>Viernes</option>
                    <option value={4}>Jueves</option>
                    <option value={3}>Miércoles</option>
                    <option value={2}>Martes</option>
                    <option value={1}>Lunes</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-400">
                    El último día que abre. Ese día, a quien cierre la tienda le sale el arqueo
                    como paso obligatorio de su cierre de turno: cuenta el efectivo acumulado y
                    lo mete en el sobre.
                  </p>
                </div>
              )}

              {/* El export de facturación identifica la tienda con el código
                  del operador y sus nombres no son los nuestros: sin esto, sus
                  líneas se importan sin tienda (ticket 4b8e1d05). */}
              <div className="col-span-2">
                <label htmlFor="codigo-externo" className="text-sm font-medium text-slate-800 block mb-1">
                  Código en el sistema de facturación
                </label>
                <input
                  id="codigo-externo"
                  type="text"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  placeholder="MY128022"
                  value={form.codigoExterno}
                  onChange={(e) => setForm((f) => ({ ...f, codigoExterno: e.target.value }))}
                />
                <p className="mt-1 text-xs text-slate-400">
                  El que aparece delante del nombre en su export («MY128022 - NEKSUS MADRID CC
                  PLENILUNIO»). Es por lo que se casa cada línea facturada con esta tienda.
                </p>
              </div>

              <div className="col-span-2 flex items-center justify-between rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                <span className="text-xs text-slate-500">
                  Las coordenadas se calculan solas al guardar. Pulsa para previsualizarlas y afinar.
                </span>
                <Button type="button" variant="outline" size="sm" onClick={ubicar} disabled={geocoding}>
                  <LocateFixed className="h-3.5 w-3.5 mr-1.5" />
                  {geocoding ? "Ubicando…" : "Ubicar automáticamente"}
                </Button>
              </div>
              <div>
                <Label>Latitud (geofencing)</Label>
                <Input className="mt-1" type="number" step="0.0001" value={form.latitud} onChange={(e) => setForm((f) => ({ ...f, latitud: e.target.value }))} placeholder="40.4168" />
              </div>
              <div>
                <Label>Longitud (geofencing)</Label>
                <Input className="mt-1" type="number" step="0.0001" value={form.longitud} onChange={(e) => setForm((f) => ({ ...f, longitud: e.target.value }))} placeholder="-3.7038" />
              </div>
              <div>
                <Label>Radio geofencing (metros)</Label>
                <Input className="mt-1" type="number" value={form.radio} onChange={(e) => setForm((f) => ({ ...f, radio: e.target.value }))} placeholder="200" />
              </div>
              <div className="col-span-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--primary)]"
                    checked={form.exigirFichajeEnSede}
                    onChange={(e) => setForm((f) => ({ ...f, exigirFichajeEnSede: e.target.checked }))}
                  />
                  <span className="text-sm font-medium text-slate-800">Exigir fichar desde esta sede</span>
                </label>
                <p className="mt-1 text-xs text-slate-400">
                  Fuera del radio no se podrá fichar directamente: el empleado tendrá que explicar el
                  motivo y quedará como solicitud pendiente de tu aprobación en “Aprobaciones de
                  fichaje”. Necesita coordenadas en la sede.
                </p>
              </div>
              <div>
                <Label>Color</Label>
                <div className="mt-1 flex gap-2 flex-wrap">
                  {COLORES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={cn("w-7 h-7 rounded-full border-2 transition-all", form.color === c ? "border-slate-800 scale-110" : "border-transparent")}
                      style={{ backgroundColor: c }}
                      onClick={() => setForm((f) => ({ ...f, color: c }))}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Guardando..." : editando ? "Actualizar" : "Crear Sede"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SedeHorariosDialog
        tienda={horariosTienda}
        otrasSedes={tiendas
          .filter((t) => t.activa && t.id !== horariosTienda?.id)
          .map((t) => ({ id: t.id, nombre: t.nombre }))}
        onClose={() => setHorariosTienda(null)}
      />
      <SedeEmpleadosDialog
        tienda={empleadosTienda}
        onClose={() => setEmpleadosTienda(null)}
        onSaved={fetchTiendas}
      />
    </div>
  );
}
