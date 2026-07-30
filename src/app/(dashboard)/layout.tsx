import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prismaApp as prisma, prismaMaster } from "@/lib/prisma";
import { currentTenant } from "@/lib/tenant/context";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { FeedbackButton } from "@/components/feedback/feedback-button";

async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const user = session.user as any;
  const sessionUser = {
    id: user.id ?? "",
    nombre: user.nombre ?? user.name ?? "Usuario",
    apellidos: user.apellidos ?? "",
    email: user.email ?? "",
    rol: user.rol ?? "EMPLEADO",
    tiendaId: user.tiendaId ?? null,
  };

  // Onboarding obligatorio: empleados y managers deben rellenar sus datos
  // personales (DNI, teléfono, fecha de nacimiento) en el primer acceso.
  // El OWNER queda exento. Se consulta en BD para reflejar el estado real
  // (el JWT podría estar desactualizado tras completar el perfil).
  // Acceso anticipado al módulo de cierre de turno mientras está en rodaje.
  // Se lee en la misma consulta que el onboarding para no añadir otra.
  let accesoAnticipadoCierre = false;
  if (sessionUser.rol === "EMPLEADO" || sessionUser.rol === "MANAGER") {
    const u = await prisma.user
      .findUnique({
        where: { id: sessionUser.id },
        select: { perfilCompletado: true, cierreTurnoPiloto: true },
      })
      .catch(() => null);
    accesoAnticipadoCierre = u?.cierreTurnoPiloto === true;
    if (u && !u.perfilCompletado) {
      redirect("/completar-perfil");
    }
  }

  const branding = await prisma.configuracionEmpresa.findFirst({
    select: {
      logo: true,
      appNombre: true,
      nombre: true,
      // Módulo de cierre de turno en rodaje: visible solo para administración
      // mientras se prepara (catálogo, PIN de recogida, objetivos del mes).
      cierreTurnoEnRodaje: true,
    },
  }).catch(() => null);

  // Trial banner: si el tenant tiene una subscription en estado
  // "trialing" o no tiene subscription activa todavía, mostramos un
  // aviso global con CTA para activar la cuenta.
  let trial: { trialEnd: string | null; isTrialing: boolean } | null = null;
  try {
    const { tenantId } = currentTenant();
    const sub = await prismaMaster.subscription.findFirst({
      where: { tenantId },
      select: { status: true, trialEnd: true },
      orderBy: { updatedAt: "desc" },
    });
    if (sub?.status === "trialing") {
      trial = {
        trialEnd: sub.trialEnd ? sub.trialEnd.toISOString() : null,
        isTrialing: true,
      };
    }
  } catch {
    // Sin contexto de tenant o BD caída → no banner, no romper layout.
  }

  // Sin fila de configuración todavía, se asume rodaje: es el lado prudente
  // (que no le aparezca a la plantilla algo aún sin configurar).
  const enRodaje = branding?.cierreTurnoEnRodaje ?? true;

  return (
    <DashboardShell
      user={sessionUser}
      branding={{
        logo: branding?.logo ?? null,
        appNombre: branding?.appNombre ?? "empleaIA",
        nombre: branding?.nombre ?? null,
      }}
      trial={trial}
      cierreTurnoEnRodaje={enRodaje}
      cierreTurnoAccesoAnticipado={accesoAnticipadoCierre}
    >
      {children}
      {process.env.NEXT_PUBLIC_BETA_FEEDBACK === "true" && <FeedbackButton />}
    </DashboardShell>
  );
}

export default withTenantPage(DashboardLayout as never);
