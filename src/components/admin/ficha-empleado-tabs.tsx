"use client";

import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Calendar,
  Clock,
  Mail,
  Phone,
  MapPin,
  Building2,
  User as UserIcon,
  CalendarOff,
  Briefcase,
  Globe,
  Smartphone,
  Tablet,
  ScanFace,
  Euro,
  Save,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { cn, getColorRol, getLabelRol } from "@/lib/utils";
import { EmpleadoDatosForm, type EmpleadoDatos } from "@/components/empleados/empleado-datos-form";
import { CamposPersonalizadosFicha } from "@/components/admin/campos-personalizados-ficha";

type Rol = "OWNER" | "MANAGER" | "EMPLEADO";
type TipoFichaje = "ENTRADA" | "PAUSA" | "VUELTA_PAUSA" | "SALIDA";
type MetodoFichaje = "WEB" | "MOVIL" | "TABLET" | "MANUAL";
type EstadoAusencia = "PENDIENTE" | "APROBADA" | "RECHAZADA" | "CANCELADA";
type EstadoTurno = "BORRADOR" | "PUBLICADO";

interface Props {
  empleado: {
    id: string;
    nombre: string;
    apellidos: string;
    email: string;
    dni: string | null;
    telefono: string | null;
    foto: string | null;
    fechaNacimiento: string | null;
    rol: Rol;
    activo: boolean;
    createdAt: string;
    tienda: { id: string; nombre: string; color: string; ciudad: string } | null;
    manager: { id: string; nombre: string; apellidos: string } | null;
    empresa: { id: string; nombre: string } | null;
    salarioBase: number | null;
  };
  viewerRol?: Rol;
  fichaDatos: EmpleadoDatos;
  metricas: {
    horas30d: number;
    diasTrabajados30d: number;
    diasAusenciaUlt12m: number;
    diasAusenciaPendientes: number;
    totalFichajes: number;
    sedesFichaje: { nombre: string; color: string }[];
  };
  fichajes: {
    id: string;
    timestamp: string;
    tipo: TipoFichaje;
    metodo: MetodoFichaje;
    nota: string | null;
    tienda: { nombre: string; color: string } | null;
  }[];
  ausencias: {
    id: string;
    fechaInicio: string;
    fechaFin: string;
    dias: number;
    motivo: string | null;
    estado: EstadoAusencia;
    tipoAusencia: { nombre: string; color: string; pagada: boolean };
  }[];
  turnos: {
    id: string;
    fecha: string;
    horaInicio: string;
    horaFin: string;
    estado: EstadoTurno;
    tienda: { nombre: string; color: string };
  }[];
}

const TIPO_LABEL: Record<TipoFichaje, string> = {
  ENTRADA: "Entrada",
  PAUSA: "Pausa",
  VUELTA_PAUSA: "Vuelta",
  SALIDA: "Salida",
};
const TIPO_CLS: Record<TipoFichaje, string> = {
  ENTRADA: "bg-emerald-50 text-emerald-700",
  PAUSA: "bg-amber-50 text-amber-700",
  VUELTA_PAUSA: "bg-sky-50 text-sky-700",
  SALIDA: "bg-rose-50 text-rose-700",
};

function MetodoIcon({ m }: { m: MetodoFichaje }) {
  if (m === "MOVIL") return <Smartphone className="h-3.5 w-3.5" />;
  if (m === "TABLET") return <Tablet className="h-3.5 w-3.5" />;
  if (m === "MANUAL") return <ScanFace className="h-3.5 w-3.5" />;
  return <Globe className="h-3.5 w-3.5" />;
}

function estadoAusenciaTone(
  e: EstadoAusencia,
): "success" | "warning" | "neutral" {
  if (e === "APROBADA") return "success";
  if (e === "PENDIENTE") return "warning";
  return "neutral";
}

export function FichaEmpleadoTabs({
  empleado,
  fichaDatos,
  metricas,
  fichajes,
  ausencias,
  turnos,
  viewerRol,
}: Props) {
  const nombreCompleto = `${empleado.nombre} ${empleado.apellidos}`;
  const altaDate = new Date(empleado.createdAt);
  const puedeEditarSalario = viewerRol === "OWNER";
  const puedeEditarFicha = viewerRol === "OWNER";
  // OWNER y MANAGER pueden VER la ficha completa; solo OWNER la edita.
  const puedeVerFicha = viewerRol === "OWNER" || viewerRol === "MANAGER";
  const [salarioInput, setSalarioInput] = useState<string>(
    empleado.salarioBase != null ? String(empleado.salarioBase) : "",
  );
  const [salarioActual, setSalarioActual] = useState<number | null>(
    empleado.salarioBase,
  );
  const [savingSalario, setSavingSalario] = useState(false);
  const [salarioMsg, setSalarioMsg] = useState<string | null>(null);

  const guardarSalario = async () => {
    setSavingSalario(true);
    setSalarioMsg(null);
    const trimmed = salarioInput.trim();
    const salarioBase = trimmed === "" ? null : Number(trimmed);
    if (salarioBase !== null && (Number.isNaN(salarioBase) || salarioBase < 0)) {
      setSalarioMsg("Importe inválido");
      setSavingSalario(false);
      return;
    }
    try {
      const res = await fetch(`/api/empleados/${empleado.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salarioBase }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSalarioActual(salarioBase);
      setSalarioMsg("Guardado");
      setTimeout(() => setSalarioMsg(null), 2000);
    } catch {
      setSalarioMsg("Error al guardar");
    } finally {
      setSavingSalario(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ─── Cabecera ───────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6 pb-6">
          <div className="flex items-start gap-5 flex-wrap">
            {empleado.foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={empleado.foto}
                alt={nombreCompleto}
                className="h-20 w-20 rounded-full object-cover border-2 border-white shadow-sm"
              />
            ) : (
              <EmployeeAvatar
                nombre={empleado.nombre}
                apellidos={empleado.apellidos}
                seed={empleado.id}
                size="lg"
              />
            )}

            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-900">
                  {nombreCompleto}
                </h1>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                    getColorRol(empleado.rol),
                  )}
                >
                  {getLabelRol(empleado.rol)}
                </span>
                <StatusPill
                  tone={empleado.activo ? "success" : "neutral"}
                  label={empleado.activo ? "Activo" : "Inactivo"}
                />
              </div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-600">
                <span className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  {empleado.email}
                </span>
                {empleado.telefono && (
                  <span className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-slate-400" />
                    {empleado.telefono}
                  </span>
                )}
                {empleado.dni && (
                  <span className="flex items-center gap-2">
                    <UserIcon className="h-3.5 w-3.5 text-slate-400" />
                    DNI: {empleado.dni}
                  </span>
                )}
                {empleado.tienda && (
                  <span className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" />
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: empleado.tienda.color }}
                    />
                    {empleado.tienda.nombre} · {empleado.tienda.ciudad}
                  </span>
                )}
                {empleado.manager && (
                  <span className="flex items-center gap-2">
                    <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                    Responsable: {empleado.manager.nombre}{" "}
                    {empleado.manager.apellidos}
                  </span>
                )}
                {empleado.empresa && (
                  <span className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-slate-400" />
                    {empleado.empresa.nombre}
                  </span>
                )}
                <span className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  Alta: {format(altaDate, "d MMM yyyy", { locale: es })}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Datos laborales ──────────────────────────────────────────── */}
      {(puedeEditarSalario || salarioActual != null) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Euro className="h-4 w-4 text-[var(--primary)]" />
              Datos laborales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Salario base mensual (€)
                </label>
                {puedeEditarSalario ? (
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="(usa default empresa)"
                    value={salarioInput}
                    onChange={(e) => setSalarioInput(e.target.value)}
                    className="w-40 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                    disabled={savingSalario}
                  />
                ) : (
                  <span className="text-sm text-slate-900">
                    {salarioActual != null
                      ? salarioActual.toLocaleString("es-ES", {
                          style: "currency",
                          currency: "EUR",
                        })
                      : "(no definido)"}
                  </span>
                )}
              </div>
              {puedeEditarSalario && (
                <button
                  onClick={guardarSalario}
                  disabled={savingSalario}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] text-white px-3 py-1.5 text-sm hover:opacity-90 disabled:opacity-50"
                >
                  {savingSalario ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Guardar
                </button>
              )}
              {salarioMsg && (
                <span className="text-xs text-slate-500">{salarioMsg}</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Vacío = usar el salario base por defecto de la empresa (Configuración → Nómina).
            </p>
          </CardContent>
        </Card>
      )}

      {/* ─── Métricas ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Horas últimos 30 días"
          value={`${metricas.horas30d.toFixed(0)}h`}
          subtitle={`${metricas.diasTrabajados30d} días trabajados`}
          tone="primary"
        />
        <MetricCard
          label="Días libres (12m)"
          value={metricas.diasAusenciaUlt12m.toString()}
          subtitle={
            metricas.diasAusenciaPendientes > 0
              ? `+${metricas.diasAusenciaPendientes} pendientes`
              : "Aprobados"
          }
          tone="warning"
        />
        <MetricCard
          label="Total fichajes"
          value={metricas.totalFichajes.toLocaleString("es-ES")}
          subtitle="Histórico completo"
          tone="neutral"
        />
        <MetricCard
          label="Sedes (30d)"
          value={metricas.sedesFichaje.length.toString()}
          subtitle={
            metricas.sedesFichaje.length === 0
              ? "Sin fichajes recientes"
              : metricas.sedesFichaje.map((s) => s.nombre).join(", ")
          }
          tone="success"
        />
      </div>

      {/* ─── Tabs ───────────────────────────────────────────────────── */}
      <Tabs defaultValue={puedeVerFicha ? "datos" : "fichajes"}>
        <TabsList>
          {puedeVerFicha && <TabsTrigger value="datos">Datos</TabsTrigger>}
          <TabsTrigger value="fichajes">Fichajes (30d)</TabsTrigger>
          <TabsTrigger value="ausencias">Ausencias (12m)</TabsTrigger>
          <TabsTrigger value="turnos">Próximos turnos</TabsTrigger>
        </TabsList>

        {/* ── Datos: OWNER y MANAGER ven la ficha; solo OWNER la edita ── */}
        {puedeVerFicha && (
          <TabsContent value="datos">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <UserIcon className="h-4 w-4 text-[var(--primary)]" />
                  Datos del empleado
                  {!puedeEditarFicha && (
                    <span className="text-xs font-normal text-slate-400">(solo lectura)</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <EmpleadoDatosForm empleado={fichaDatos} modo="admin" soloLectura={!puedeEditarFicha} />
              </CardContent>
            </Card>
            <div className="mt-6">
              <CamposPersonalizadosFicha
                empleadoId={empleado.id}
                puedeEditar={puedeEditarFicha}
              />
            </div>
          </TabsContent>
        )}

        {/* ── Fichajes ── */}
        <TabsContent value="fichajes">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-[var(--primary)]" />
                Historial de fichajes — últimos 30 días
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {fichajes.length === 0 ? (
                <p className="text-center py-8 text-slate-400 text-sm">
                  Sin fichajes en los últimos 30 días.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        {["Fecha", "Hora", "Tipo", "Método", "Sede", "Nota"].map(
                          (h) => (
                            <th
                              key={h}
                              className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3"
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {fichajes.map((f) => {
                        const d = new Date(f.timestamp);
                        return (
                          <tr
                            key={f.id}
                            className="hover:bg-slate-50 transition-colors"
                          >
                            <td className="px-4 py-2.5 text-sm text-slate-700 whitespace-nowrap">
                              {format(d, "dd/MM/yyyy")}
                            </td>
                            <td className="px-4 py-2.5 text-sm font-mono text-slate-900 whitespace-nowrap">
                              {format(d, "HH:mm")}
                            </td>
                            <td className="px-4 py-2.5">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${TIPO_CLS[f.tipo]}`}
                              >
                                {TIPO_LABEL[f.tipo]}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                                <MetodoIcon m={f.metodo} />
                                {f.metodo}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-sm text-slate-600">
                              {f.tienda ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: f.tienda.color }}
                                  />
                                  {f.tienda.nombre}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td
                              className="px-4 py-2.5 text-sm text-slate-500 max-w-[240px] truncate"
                              title={f.nota ?? ""}
                            >
                              {f.nota || "—"}
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
        </TabsContent>

        {/* ── Ausencias ── */}
        <TabsContent value="ausencias">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarOff className="h-4 w-4 text-amber-500" />
                Ausencias, vacaciones y bajas — últimos 12 meses
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {ausencias.length === 0 ? (
                <p className="text-center py-8 text-slate-400 text-sm">
                  Sin ausencias registradas en los últimos 12 meses.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        {[
                          "Tipo",
                          "Desde",
                          "Hasta",
                          "Días",
                          "Pagada",
                          "Estado",
                          "Motivo",
                        ].map((h) => (
                          <th
                            key={h}
                            className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {ausencias.map((a) => (
                        <tr
                          key={a.id}
                          className="hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-4 py-2.5 text-sm">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{
                                  backgroundColor: a.tipoAusencia.color,
                                }}
                              />
                              <span className="font-medium text-slate-900">
                                {a.tipoAusencia.nombre}
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-sm text-slate-700 whitespace-nowrap">
                            {format(new Date(a.fechaInicio), "dd/MM/yyyy")}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-slate-700 whitespace-nowrap">
                            {format(new Date(a.fechaFin), "dd/MM/yyyy")}
                          </td>
                          <td className="px-4 py-2.5 text-sm font-semibold text-slate-900">
                            {a.dias}
                          </td>
                          <td className="px-4 py-2.5 text-sm">
                            {a.tipoAusencia.pagada ? (
                              <Badge variant="secondary">Sí</Badge>
                            ) : (
                              <Badge variant="outline">No</Badge>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusPill
                              tone={estadoAusenciaTone(a.estado)}
                              label={a.estado.toLowerCase()}
                            />
                          </td>
                          <td
                            className="px-4 py-2.5 text-sm text-slate-500 max-w-[260px] truncate"
                            title={a.motivo ?? ""}
                          >
                            {a.motivo || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Turnos ── */}
        <TabsContent value="turnos">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4 text-sky-500" />
                Próximos turnos — siguientes 30 días
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {turnos.length === 0 ? (
                <p className="text-center py-8 text-slate-400 text-sm">
                  Sin turnos programados.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        {["Fecha", "Horario", "Sede", "Estado"].map((h) => (
                          <th
                            key={h}
                            className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {turnos.map((t) => (
                        <tr
                          key={t.id}
                          className="hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-4 py-2.5 text-sm text-slate-700 whitespace-nowrap">
                            {format(new Date(t.fecha), "EEE d MMM", {
                              locale: es,
                            })}
                          </td>
                          <td className="px-4 py-2.5 text-sm font-mono text-slate-900 whitespace-nowrap">
                            {t.horaInicio} – {t.horaFin}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-slate-600">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: t.tienda.color }}
                              />
                              {t.tienda.nombre}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusPill
                              tone={t.estado === "PUBLICADO" ? "success" : "warning"}
                              label={t.estado.toLowerCase()}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: string;
  subtitle: string;
  tone: "primary" | "warning" | "neutral" | "success";
}) {
  const colorCls = {
    primary: "text-[var(--primary)]",
    warning: "text-amber-600",
    neutral: "text-slate-900",
    success: "text-emerald-600",
  }[tone];
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">
          {label}
        </p>
        <p className={`text-2xl font-bold mt-1 ${colorCls}`}>{value}</p>
        <p className="text-xs text-slate-500 mt-1 truncate" title={subtitle}>
          {subtitle}
        </p>
      </CardContent>
    </Card>
  );
}
