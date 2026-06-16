"use client";

import { EmpleadoDatosForm, type EmpleadoDatos } from "@/components/empleados/empleado-datos-form";

export function CompletarPerfilForm({
  empleado,
  home,
  nombre,
}: {
  empleado: EmpleadoDatos;
  home: string;
  nombre: string;
}) {
  return (
    <div className="min-h-screen flex items-start justify-center p-4 bg-slate-50">
      <main className="w-full max-w-2xl my-8">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-7 py-8">
          <h1 className="text-xl font-bold text-slate-900">
            Bienvenido/a{nombre ? `, ${nombre}` : ""}
          </h1>
          <p className="mt-1.5 mb-6 text-sm text-slate-500">
            Antes de empezar, completa tus datos personales. Los campos marcados
            con <span className="text-red-500">*</span> son obligatorios.
          </p>

          <EmpleadoDatosForm empleado={empleado} modo="onboarding" redirectTo={home} />
        </div>
      </main>
    </div>
  );
}
