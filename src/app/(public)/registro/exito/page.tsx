/**
 * Página tras un alta en /registro.
 *
 * Dos modos:
 *  - `?slug=<slug>` — alta directa SIN tarjeta (flujo actual). El tenant
 *    ya quedó `active` de forma síncrona en la server action; aquí solo
 *    confirmamos y dirigimos al login + recordamos el email de
 *    set-password. Sin polling.
 *  - `?session_id=cs_...` — alta con Stripe Checkout (reintegración
 *    pendiente). Hace polling a /api/onboarding/status hasta `active`.
 */

import { ExitoCliente } from "./exito-cliente";

export const dynamic = "force-dynamic";

function buildLoginUrl(slug: string): string {
  const root = process.env.TENANT_ROOT_DOMAIN ?? "ficha.tecnocloud.es";
  const proto = root === "localhost" ? "http" : "https";
  const port = root === "localhost" ? ":3000" : "";
  return `${proto}://${slug}.${root}${port}/login`;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; slug?: string }>;
}) {
  const { session_id, slug } = await searchParams;

  // Alta directa sin tarjeta: confirmación estática.
  if (slug) {
    const loginUrl = buildLoginUrl(slug);
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <main className="text-center max-w-md w-full">
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-8 py-10">
            <h1 className="text-2xl font-bold text-slate-900">
              ¡Tu cuenta está lista!
            </h1>
            <p className="mt-4 text-sm text-slate-600">
              Hemos creado <strong className="text-slate-900">{slug}</strong> y
              te hemos enviado un email para que establezcas tu contraseña.
              Revisa tu bandeja de entrada (y la carpeta de spam).
            </p>
            <a
              href={loginUrl}
              className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark)] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors"
            >
              Ir a iniciar sesión
            </a>
          </div>
        </main>
      </div>
    );
  }

  // Flujo Stripe (reintegración pendiente): polling.
  if (session_id) {
    return <ExitoCliente sessionId={session_id} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <main className="text-center max-w-md bg-white border border-slate-200 rounded-lg shadow-sm px-8 py-10">
        <h1 className="text-2xl font-bold text-slate-900">Página de éxito</h1>
        <p className="text-sm text-slate-500 mt-2">
          Esta página se muestra tras completar el registro.
        </p>
      </main>
    </div>
  );
}
