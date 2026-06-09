/**
 * Onboarding obligatorio de datos personales (primer acceso).
 *
 * Vive FUERA del grupo (dashboard) a propósito: el layout del dashboard
 * redirige aquí a empleados/managers sin perfil completo, así que esta
 * página no debe pasar por ese layout (evita bucle de redirección) ni
 * mostrar el sidebar — es una pantalla bloqueante a pantalla completa.
 */

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { CompletarPerfilForm } from "./completar-perfil-form";

async function CompletarPerfilPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const su = session.user as { id?: string; rol?: string };
  const rol = su.rol ?? "EMPLEADO";
  // El OWNER queda exento del onboarding obligatorio.
  if (rol === "OWNER") redirect("/admin");

  const u = await prisma.user.findUnique({
    where: { id: su.id ?? "" },
    select: {
      nombre: true,
      dni: true,
      telefono: true,
      fechaNacimiento: true,
      perfilCompletado: true,
    },
  });
  if (!u) redirect("/login");

  const home = rol === "MANAGER" ? "/manager" : "/empleado";
  if (u.perfilCompletado) redirect(home);

  return (
    <CompletarPerfilForm
      userId={su.id ?? ""}
      home={home}
      nombre={u.nombre}
      initial={{
        dni: u.dni ?? "",
        telefono: u.telefono ?? "",
        fechaNacimiento: u.fechaNacimiento
          ? u.fechaNacimiento.toISOString().slice(0, 10)
          : "",
      }}
    />
  );
}

export default withTenantPage(CompletarPerfilPage as never);
