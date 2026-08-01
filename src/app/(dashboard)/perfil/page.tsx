import { redirect } from "next/navigation";
import { User } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { auth } from "@/lib/auth";
import { prismaApp } from "@/lib/prisma";
import { FICHA_SELECT, toEmpleadoDatos } from "@/lib/empleados/ficha";
import { PerfilForm } from "./perfil-form";

async function PerfilPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  const user = await prismaApp.user.findUnique({
    where: { id: userId },
    select: { ...FICHA_SELECT, rol: true, tienda: { select: { nombre: true } } },
  });
  if (!user) redirect("/login");

  const empleado = toEmpleadoDatos(user);

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="flex items-start gap-3">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <User className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            Mi perfil
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            {user.rol}
            {user.tienda?.nombre ? ` · ${user.tienda.nombre}` : ""}
          </p>
        </div>
      </header>

      <div className="rounded-xl border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-6">
        <PerfilForm empleado={empleado} />
      </div>
    </div>
  );
}

export default withTenantPage(PerfilPage);
