import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * El root layout sirve TODOS los hosts (apex, app, admin, tenant). Hacer
 * una query a `prismaApp.configuracionEmpresa` aquí significaría:
 *  1. 1 query master por cada navegación, incluso para subdominios
 *     `app.localhost/registro` que NO tienen tenant.
 *  2. Imposible envolver con `withTenantPage` porque el layout sirve
 *     hosts donde NO hay tenant.
 *
 * Solución (opción C parcial Bug 4 Fase 4): el root layout usa branding
 * **default hardcoded**. El branding por tenant se aplica desde el
 * layout/page del subdominio tenant que SÍ está envuelto con
 * `withTenantPage` (e.g. `(dashboard)/layout.tsx`,
 * `(auth)/login/page.tsx`).
 *
 * Trade-off aceptado: el "<title>" del navegador es siempre el default
 * "Fichaje" hasta que el layout hijo del tenant pueda renderear su
 * título. En la práctica los usuarios siempre llegan a páginas dentro
 * del tenant donde el título correcto se computa antes de mostrarse.
 */

const DEFAULT_BRANDING = {
  appNombre: "empleaIA",
  colorPrimario: "#2563EB",
  favicon: null as string | null,
};

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: {
      default: DEFAULT_BRANDING.appNombre,
      template: `%s | ${DEFAULT_BRANDING.appNombre}`,
    },
    description: "empleaIA — gestión inteligente de personal con IA",
    manifest: "/manifest.webmanifest",
    // El favicon se genera dinámicamente desde src/app/icon.tsx
    // (convención Next 13+). Apple touch icon: src/app/apple-icon.tsx.
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: DEFAULT_BRANDING.appNombre,
    },
    formatDetection: { telephone: false },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Branding default empleaIA. El tenant override (colorPrimario)
  // se aplica desde el layout del subdominio tenant via withTenantPage.
  const cssVars = `
    :root {
      --primary: ${DEFAULT_BRANDING.colorPrimario};
      --ring: ${DEFAULT_BRANDING.colorPrimario};
      --accent-foreground: ${DEFAULT_BRANDING.colorPrimario};
      --sidebar-active-text: ${DEFAULT_BRANDING.colorPrimario};
      --sidebar-active-border: ${DEFAULT_BRANDING.colorPrimario};
    }
  `;

  // Preferencia de tema. Sin cookie se asume claro: la del sistema no viaja
  // al servidor, así que la primera visita entra en claro y basta un clic.
  const tema = (await cookies()).get("empleaia-theme")?.value === "dark" ? "dark" : "light";

  return (
    // El tema sale de una cookie y lo pinta el SERVIDOR. Nada de un script en
    // el <head> que lo ajuste antes de hidratar: React avisa por consola de
    // cualquier <script> dentro de su árbol (no lo ejecuta al navegar en
    // cliente), y con next/script pasa igual. Al venir del servidor no hay
    // parpadeo ni desajuste de hidratación, que era justo lo que se quería.
    <html lang="es" data-theme={tema} className={`${inter.variable} h-full`} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: cssVars }} />
      </head>
      <body className="h-full antialiased">
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
