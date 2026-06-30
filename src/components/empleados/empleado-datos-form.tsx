"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { CAMPOS_OBLIGATORIOS } from "@/lib/empleados/perfil";

/**
 * Formulario reutilizable de la ficha de empleado ampliada.
 *
 * modo:
 *  - "onboarding": solo secciones obligatorias (personal + dirección +
 *    contacto), valida que estén completas y redirige a `redirectTo`.
 *  - "self": el empleado edita toda su ficha desde "Mi perfil".
 *  - "admin": el OWNER edita la ficha desde la ficha 360º.
 *
 * Todos los modos hacen PUT a /api/empleados/[id]. La gobernanza
 * (rol, sede, salario, horas) se gestiona fuera de este formulario.
 */

export interface EmpleadoDatos {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  tipoIdentificacion: string | null;
  dni: string | null;
  tipoIdentificacionSecundaria: string | null;
  numeroIdentificacionSecundaria: string | null;
  nacionalidad: string | null;
  estadoCivil: string | null;
  genero: string | null;
  compartirCumpleanos: boolean;
  fechaNacimiento: string | null;
  domicilio: string | null;
  codigoPostal: string | null;
  localidad: string | null;
  provincia: string | null;
  pais: string | null;
  emailEmpresa: string | null;
  emailPersonal: string | null;
  emailNotificaciones: string | null;
  telefono: string | null;
  telefonoEmpresa: string | null;
  telefonoEmergencia: string | null;
  contactoUrgencia: string | null;
  teletrabajo: boolean;
  grupoCotizacion: string | null;
  categoriaProfesional: string | null;
  numeroSeguridadSocial: string | null;
  codigoContrato: string | null;
  numeroHijos: number | null;
  porcentajeDiscapacidad: number | null;
  titularCuenta: string | null;
  iban: string | null;
  bic: string | null;
  entidadBancaria: string | null;
}

const TIPOS_ID = ["DNI", "NIE", "Pasaporte", "Otro"];
const ESTADOS_CIVILES = [
  "Soltero/a",
  "Casado/a",
  "Pareja de hecho",
  "Divorciado/a",
  "Separado/a",
  "Viudo/a",
];
const GENEROS = ["Femenino", "Masculino", "No binario", "Prefiero no decirlo"];

const INPUT =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20";
const LABEL = "text-sm font-medium text-slate-700";
const SECTION = "text-base font-semibold text-slate-900";

// Componentes de campo a nivel de módulo (no anidados): de lo contrario
// React los remonta en cada render y los inputs pierden el foco.
function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1.5">
      <span className={LABEL}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <input
        className={INPUT}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required?: boolean;
}) {
  return (
    <label className="grid gap-1.5">
      <span className={LABEL}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <select className={INPUT} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Selecciona una opción</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

type FormState = Record<string, string | boolean>;

function initialState(e: EmpleadoDatos): FormState {
  const s = (v: string | null) => v ?? "";
  return {
    nombre: s(e.nombre),
    apellidos: s(e.apellidos),
    email: s(e.email),
    tipoIdentificacion: s(e.tipoIdentificacion),
    dni: s(e.dni),
    tipoIdentificacionSecundaria: s(e.tipoIdentificacionSecundaria),
    numeroIdentificacionSecundaria: s(e.numeroIdentificacionSecundaria),
    nacionalidad: s(e.nacionalidad),
    estadoCivil: s(e.estadoCivil),
    genero: s(e.genero),
    fechaNacimiento: s(e.fechaNacimiento),
    domicilio: s(e.domicilio),
    codigoPostal: s(e.codigoPostal),
    localidad: s(e.localidad),
    provincia: s(e.provincia),
    pais: e.pais ?? "España",
    emailEmpresa: s(e.emailEmpresa),
    emailPersonal: s(e.emailPersonal),
    emailNotificaciones: s(e.emailNotificaciones),
    telefono: s(e.telefono),
    telefonoEmpresa: s(e.telefonoEmpresa),
    telefonoEmergencia: s(e.telefonoEmergencia),
    contactoUrgencia: s(e.contactoUrgencia),
    grupoCotizacion: s(e.grupoCotizacion),
    categoriaProfesional: s(e.categoriaProfesional),
    numeroSeguridadSocial: s(e.numeroSeguridadSocial),
    codigoContrato: s(e.codigoContrato),
    numeroHijos: e.numeroHijos == null ? "" : String(e.numeroHijos),
    porcentajeDiscapacidad:
      e.porcentajeDiscapacidad == null ? "" : String(e.porcentajeDiscapacidad),
    titularCuenta: s(e.titularCuenta),
    iban: s(e.iban),
    bic: s(e.bic),
    entidadBancaria: s(e.entidadBancaria),
    compartirCumpleanos: e.compartirCumpleanos,
    teletrabajo: e.teletrabajo,
  };
}

export function EmpleadoDatosForm({
  empleado,
  modo,
  redirectTo,
  onSaved,
  soloLectura = false,
}: {
  empleado: EmpleadoDatos;
  modo: "self" | "admin" | "onboarding";
  redirectTo?: string;
  onSaved?: () => void;
  /** Vista de solo lectura (p. ej. MANAGER consulta la ficha sin editar). */
  soloLectura?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialState(empleado));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const esOnboarding = modo === "onboarding";
  const txt = (k: string) => form[k] as string;
  const set = (k: string, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  function validarObligatorios(): string | null {
    for (const campo of CAMPOS_OBLIGATORIOS) {
      const v = form[campo as string];
      if (!v || (typeof v === "string" && v.trim() === "")) {
        return "Completa todos los campos obligatorios (marcados con *).";
      }
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSavedAt(null);

    if (esOnboarding) {
      const err = validarObligatorios();
      if (err) {
        setError(err);
        return;
      }
    }

    const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
    const payload: Record<string, unknown> = {
      nombre: form.nombre,
      apellidos: form.apellidos,
      email: form.email,
      tipoIdentificacion: form.tipoIdentificacion,
      dni: form.dni,
      tipoIdentificacionSecundaria: form.tipoIdentificacionSecundaria,
      numeroIdentificacionSecundaria: form.numeroIdentificacionSecundaria,
      nacionalidad: form.nacionalidad,
      estadoCivil: form.estadoCivil,
      genero: form.genero,
      fechaNacimiento: form.fechaNacimiento || null,
      compartirCumpleanos: form.compartirCumpleanos,
      domicilio: form.domicilio,
      codigoPostal: form.codigoPostal,
      localidad: form.localidad,
      provincia: form.provincia,
      pais: form.pais,
      emailEmpresa: form.emailEmpresa,
      emailPersonal: form.emailPersonal,
      emailNotificaciones: form.emailNotificaciones,
      telefono: form.telefono,
      telefonoEmpresa: form.telefonoEmpresa,
      telefonoEmergencia: form.telefonoEmergencia,
      contactoUrgencia: form.contactoUrgencia,
      teletrabajo: form.teletrabajo,
      grupoCotizacion: form.grupoCotizacion,
      categoriaProfesional: form.categoriaProfesional,
      numeroSeguridadSocial: form.numeroSeguridadSocial,
      codigoContrato: form.codigoContrato,
      numeroHijos: numOrNull(txt("numeroHijos")),
      porcentajeDiscapacidad: numOrNull(txt("porcentajeDiscapacidad")),
      titularCuenta: form.titularCuenta,
      iban: form.iban,
      bic: form.bic,
      entidadBancaria: form.entidadBancaria,
    };
    // En onboarding no tocamos afiliación/retenciones/bancarios.
    if (esOnboarding) {
      for (const k of [
        "teletrabajo",
        "grupoCotizacion",
        "categoriaProfesional",
        "numeroSeguridadSocial",
        "codigoContrato",
        "numeroHijos",
        "porcentajeDiscapacidad",
        "titularCuenta",
        "iban",
        "bic",
        "entidadBancaria",
      ]) {
        delete payload[k];
      }
    }

    setPending(true);
    try {
      const r = await fetch(`/api/empleados/${empleado.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      if (esOnboarding && redirectTo) {
        window.location.href = redirectTo;
        return;
      }
      setSavedAt(Date.now());
      onSaved?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
     {/* fieldset[disabled] deshabilita todos los campos de golpe en solo lectura */}
     <fieldset disabled={soloLectura} className="m-0 min-w-0 space-y-8 border-0 p-0 disabled:opacity-100">
      {/* Información personal */}
      <section className="space-y-4">
        <h2 className={SECTION}>Información personal</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField label="Nombre" value={txt("nombre")} onChange={(v) => set("nombre", v)} required />
          <TextField label="Apellidos" value={txt("apellidos")} onChange={(v) => set("apellidos", v)} required />
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <SelectField label="Tipo ID" value={txt("tipoIdentificacion")} onChange={(v) => set("tipoIdentificacion", v)} options={TIPOS_ID} required={esOnboarding} />
            <TextField label="Nº identificación" value={txt("dni")} onChange={(v) => set("dni", v)} required={esOnboarding} />
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <SelectField label="Tipo ID 2ª" value={txt("tipoIdentificacionSecundaria")} onChange={(v) => set("tipoIdentificacionSecundaria", v)} options={TIPOS_ID} />
            <TextField label="Nº identificación 2ª" value={txt("numeroIdentificacionSecundaria")} onChange={(v) => set("numeroIdentificacionSecundaria", v)} />
          </div>
          <TextField label="Nacionalidad" value={txt("nacionalidad")} onChange={(v) => set("nacionalidad", v)} required={esOnboarding} />
          <SelectField label="Estado civil" value={txt("estadoCivil")} onChange={(v) => set("estadoCivil", v)} options={ESTADOS_CIVILES} required={esOnboarding} />
          <TextField label="Fecha de nacimiento" type="date" value={txt("fechaNacimiento")} onChange={(v) => set("fechaNacimiento", v)} required={esOnboarding} />
          <SelectField label="Género" value={txt("genero")} onChange={(v) => set("genero", v)} options={GENEROS} required={esOnboarding} />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 accent-[var(--primary)]"
            checked={Boolean(form.compartirCumpleanos)}
            onChange={(e) => set("compartirCumpleanos", e.target.checked)}
          />
          <span className="text-sm text-slate-700">Compartir cumpleaños con el equipo</span>
        </label>
      </section>

      {/* Dirección */}
      <section className="space-y-4">
        <h2 className={SECTION}>Dirección</h2>
        <TextField label="Domicilio" value={txt("domicilio")} onChange={(v) => set("domicilio", v)} required={esOnboarding} />
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField label="Código postal" value={txt("codigoPostal")} onChange={(v) => set("codigoPostal", v)} required={esOnboarding} />
          <TextField label="Localidad" value={txt("localidad")} onChange={(v) => set("localidad", v)} required={esOnboarding} />
          <TextField label="Provincia" value={txt("provincia")} onChange={(v) => set("provincia", v)} required={esOnboarding} />
          <TextField label="País" value={txt("pais")} onChange={(v) => set("pais", v)} required={esOnboarding} />
        </div>
      </section>

      {/* Contacto */}
      <section className="space-y-4">
        <h2 className={SECTION}>Contacto</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField label="Email de empresa" type="email" value={txt("emailEmpresa")} onChange={(v) => set("emailEmpresa", v)} />
          <TextField label="Email personal" type="email" value={txt("emailPersonal")} onChange={(v) => set("emailPersonal", v)} required={esOnboarding} />
          <TextField label="Email de notificaciones" type="email" value={txt("emailNotificaciones")} onChange={(v) => set("emailNotificaciones", v)} />
          <TextField label="Teléfono de empresa" type="tel" value={txt("telefonoEmpresa")} onChange={(v) => set("telefonoEmpresa", v)} />
          <TextField label="Teléfono" type="tel" value={txt("telefono")} onChange={(v) => set("telefono", v)} required={esOnboarding} />
          <TextField label="Teléfono de emergencia" type="tel" value={txt("telefonoEmergencia")} onChange={(v) => set("telefonoEmergencia", v)} />
        </div>
        <TextField label="Contacto de urgencia" value={txt("contactoUrgencia")} onChange={(v) => set("contactoUrgencia", v)} />
      </section>

      {/* Secciones solo fuera del onboarding */}
      {!esOnboarding && (
        <>
          <section className="space-y-4">
            <h2 className={SECTION}>Datos de afiliación</h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 accent-[var(--primary)]"
                checked={Boolean(form.teletrabajo)}
                onChange={(e) => set("teletrabajo", e.target.checked)}
              />
              <span className="text-sm text-slate-700">Empleado en teletrabajo</span>
            </label>
            <div className="grid sm:grid-cols-2 gap-4">
              <TextField label="Grupo de cotización" value={txt("grupoCotizacion")} onChange={(v) => set("grupoCotizacion", v)} />
              <TextField label="Categoría profesional" value={txt("categoriaProfesional")} onChange={(v) => set("categoriaProfesional", v)} />
              <TextField label="Número de Seguridad Social" value={txt("numeroSeguridadSocial")} onChange={(v) => set("numeroSeguridadSocial", v)} />
              <TextField label="Código de contrato" value={txt("codigoContrato")} onChange={(v) => set("codigoContrato", v)} />
            </div>
          </section>

          <section className="space-y-4">
            <h2 className={SECTION}>Datos para retenciones</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <TextField label="Número de hijos a cargo" type="number" value={txt("numeroHijos")} onChange={(v) => set("numeroHijos", v)} />
              <TextField label="Porcentaje de discapacidad" type="number" value={txt("porcentajeDiscapacidad")} onChange={(v) => set("porcentajeDiscapacidad", v)} />
            </div>
          </section>

          <section className="space-y-4">
            <h2 className={SECTION}>Datos bancarios</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <TextField label="Titular de la cuenta" value={txt("titularCuenta")} onChange={(v) => set("titularCuenta", v)} />
              <TextField label="Cuenta bancaria / IBAN" value={txt("iban")} onChange={(v) => set("iban", v)} />
              <TextField label="BIC" value={txt("bic")} onChange={(v) => set("bic", v)} />
              <TextField label="Entidad bancaria" value={txt("entidadBancaria")} onChange={(v) => set("entidadBancaria", v)} />
            </div>
          </section>
        </>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
      {savedAt && <p className="text-sm text-emerald-700">Cambios guardados.</p>}

      {!soloLectura && (
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {esOnboarding ? "Guardar y continuar" : "Guardar cambios"}
        </button>
      )}
     </fieldset>
    </form>
  );
}
