/**
 * Select Prisma + mapper para construir el objeto `EmpleadoDatos` que
 * consume `<EmpleadoDatosForm>`. Compartido por "Mi perfil" y la ficha
 * 360º del admin para no duplicar la lista de campos ni la conversión
 * de fechas.
 */

import type { EmpleadoDatos } from "@/components/empleados/empleado-datos-form";

/** Campos a seleccionar de `prismaApp.user` para la ficha ampliada. */
export const FICHA_SELECT = {
  id: true,
  nombre: true,
  apellidos: true,
  email: true,
  tipoIdentificacion: true,
  dni: true,
  tipoIdentificacionSecundaria: true,
  numeroIdentificacionSecundaria: true,
  nacionalidad: true,
  estadoCivil: true,
  genero: true,
  compartirCumpleanos: true,
  fechaNacimiento: true,
  domicilio: true,
  codigoPostal: true,
  localidad: true,
  provincia: true,
  pais: true,
  emailEmpresa: true,
  emailPersonal: true,
  emailNotificaciones: true,
  telefono: true,
  telefonoEmpresa: true,
  telefonoEmergencia: true,
  contactoUrgencia: true,
  teletrabajo: true,
  grupoCotizacion: true,
  categoriaProfesional: true,
  numeroSeguridadSocial: true,
  codigoContrato: true,
  numeroHijos: true,
  porcentajeDiscapacidad: true,
  titularCuenta: true,
  iban: true,
  bic: true,
  entidadBancaria: true,
} as const;

/** Fila tal cual la devuelve Prisma con FICHA_SELECT. */
export type FichaRow = Omit<EmpleadoDatos, "fechaNacimiento"> & {
  fechaNacimiento: Date | null;
};

/** Convierte la fila de Prisma al shape del formulario (fecha → "YYYY-MM-DD"). */
export function toEmpleadoDatos(u: FichaRow): EmpleadoDatos {
  return {
    ...u,
    fechaNacimiento: u.fechaNacimiento
      ? u.fechaNacimiento.toISOString().slice(0, 10)
      : null,
  };
}
