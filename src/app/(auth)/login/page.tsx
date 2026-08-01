import React from "react";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { resolveTenant } from "@/lib/tenant/resolver";
import { runWithTenant } from "@/lib/tenant/context";
import { ensureFeatureCatalogLoaded } from "@/lib/feature-guard/catalog";
import { EmpleaIALogo } from "@/components/brand/empleaia-logo";
import { GlobalLoginForm } from "./global-login-form";
import { TenantLoginForm } from "./tenant-login-form";

export const dynamic = "force-dynamic";
// Sin cache cliente/SW — el HTML depende del subdominio (form del tenant
// vs global) y un cache stale entre subdominios sirve el form incorrecto.
export const fetchCache = "force-no-store";

// ─── Server action (useActionState pattern) ──────────────────────────────────
//
// En caso de credenciales inválidas devolvemos el error como state, NO
// redirigimos. Eso evita el bug del Router Cache cliente cuya key es solo
// el path /login (sin host) y reusaba la página cacheada del subdominio
// app cuando llegabas al tenant tras un error.
//
// Solo redirigimos en caso de éxito.

interface LoginActionState {
  ok: boolean;
  error?: string;
}

async function loginAction(
  _prev: LoginActionState | null,
  formData: FormData,
): Promise<LoginActionState> {
  "use server";

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const h = await headers();
  const host = h.get("host") ?? "";
  const proto = host.includes("localhost") ? "http" : "https";
  const dest = `${proto}://${host}/`;

  // Sobreescribimos cookies callback-url antes de signIn (default
  // NextAuth las setea con NEXTAUTH_URL).
  const cookieStore = await cookies();
  cookieStore.set("__Secure-authjs.callback-url", dest, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  cookieStore.set("authjs.callback-url", dest, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
      redirectTo: dest,
    });
  } catch (error: any) {
    if (error?.digest?.startsWith?.("NEXT_REDIRECT")) {
      throw error;
    }
    const code =
      error?.type ??
      error?.name ??
      (error?.message?.includes?.("credentialssignin") ? "CredentialsSignin" : null) ??
      "CredentialsSignin";
    return { ok: false, error: code };
  }

  // Login exitoso → redirect absoluto al subdominio actual.
  revalidatePath("/", "layout");
  redirect(dest);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface LoginPageProps {
  searchParams: Promise<{ error?: string; email?: string }>;
}

async function LoginPage({ searchParams }: LoginPageProps) {
  // Fase 4: el flow de "primer admin con /setup" se eliminó. El primer
  // OWNER se crea automáticamente desde el webhook checkout.session.completed
  // (commit 7 Fase 4) tras un registro real con Stripe.

  const session = await auth();
  if (session?.user) {
    redirect("/");
  }

  const { email: prefilledEmail } = await searchParams;

  const branding = await prisma.configuracionEmpresa.findFirst({
    select: { logo: true, appNombre: true, nombre: true },
  }).catch(() => null);

  const appNombre = branding?.appNombre ?? "empleaIA";
  const empresa = branding?.nombre ?? appNombre;
  const logo = branding?.logo ?? null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--muted)]">
      {/* Sutiles blobs de color en el fondo */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-60" />
        <div className="absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-50" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Logo + tagline arriba */}
        <div className="flex flex-col items-center mb-8">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt={empresa}
              className="h-12 max-w-[200px] object-contain mb-4"
            />
          ) : (
            <EmpleaIALogo appNombre={appNombre} symbolSize={80} className="mb-4" />
          )}
          <p className="text-sm text-[var(--text-muted)]">
            {empresa !== appNombre ? empresa : "Gestión inteligente de personal"}
          </p>
        </div>

        {/* Card formulario */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-sm">
          <div className="px-6 py-6 sm:px-8 sm:py-8">
            <div className="mb-6 text-center">
              <h1 className="text-xl font-semibold text-[var(--text-dark)]">Iniciar sesión</h1>
              <p className="text-sm text-[var(--text-muted)] mt-1">Accede a tu espacio de trabajo</p>
            </div>

            <TenantLoginForm action={loginAction} initialEmail={prefilledEmail ?? ""} />

            <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
              Acceso exclusivo para empleados de {empresa}.
            </p>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
          {appNombre} &mdash; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

/**
 * `/login` se sirve desde 2 subdominios distintos con comportamiento
 * distinto:
 *   - <slug>.<root>/login   → form normal del tenant (LoginPage arriba).
 *   - app.<root>/login      → form global por email: pide email y
 *     redirige al subdominio del tenant donde existe ese usuario.
 */
export default async function LoginRoute(props: { searchParams: Promise<{ error?: string; email?: string }> }) {
  const h = await headers();
  const host = h.get("host") ?? "";
  const resolved = await resolveTenant(host);

  if (resolved.kind === "tenant" && resolved.ctx.status === "active") {
    return runWithTenant(resolved.ctx, async () => {
      await ensureFeatureCatalogLoaded();
      return LoginPage({ searchParams: props.searchParams });
    });
  }

  // Subdominios `app` y `apex` → login global con resolución por email.
  if (resolved.kind === "app" || resolved.kind === "apex") {
    const { email } = await props.searchParams;
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--muted)]">
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-60" />
          <div className="absolute -bottom-32 -left-32 h-72 w-72 rounded-full bg-[var(--primary-light)] blur-3xl opacity-50" />
        </div>
        <div className="relative w-full max-w-md animate-fade-in">
          <div className="flex flex-col items-center mb-8">
            <EmpleaIALogo appNombre="empleaIA" symbolSize={80} className="mb-4" />
            <p className="text-sm text-[var(--text-muted)]">Acceso a tu empresa</p>
          </div>
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-sm">
            <div className="px-6 py-6 sm:px-8 sm:py-8">
              <div className="mb-6 text-center">
                <h1 className="text-xl font-semibold text-[var(--text-dark)]">Iniciar sesión</h1>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  Indica tu correo y te llevamos al panel de tu empresa.
                </p>
              </div>
              <GlobalLoginForm initialEmail={email ?? ""} />
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
            empleaIA &mdash; {new Date().getFullYear()}
          </p>
        </div>
      </div>
    );
  }

  notFound();
}
