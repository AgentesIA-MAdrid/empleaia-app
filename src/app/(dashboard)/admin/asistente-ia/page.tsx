import { Bot, Settings } from "lucide-react";
import Link from "next/link";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { ChatLayout } from "./chat-layout";

async function AsistenteIAPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const cfg = await prismaApp.iAConfiguracion.findUnique({
    where: { id: "default" },
    select: { provider: true, modelo: true, activa: true },
  });
  const conversaciones = userId
    ? await prismaApp.conversacionIA.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: { id: true, titulo: true, updatedAt: true },
      })
    : [];

  return (
    <div className="space-y-6 h-full">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
            <Bot className="h-6 w-6 text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
              Asistente IA
            </h1>
            <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
              Tu copiloto inteligente para tareas de RRHH
            </p>
          </div>
        </div>
        <Link
          href="/admin/asistente-ia/configuracion"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] hover:bg-[var(--muted)] px-3 py-2 text-sm font-medium"
        >
          <Settings className="h-4 w-4" />
          Configuración
        </Link>
      </header>

      {!cfg || !cfg.activa ? (
        <div className="rounded-xl border-2 border-dashed border-amber-300 bg-[var(--warning-bg)] p-8 text-center">
          <Bot className="h-10 w-10 mx-auto text-[var(--warning-text)]" />
          <h2 className="mt-3 font-semibold text-[var(--warning-text)]">
            Aún no has configurado el asistente IA
          </h2>
          <p className="mt-1 text-sm text-[var(--warning-text)]">
            empleaIA usa <strong>BYOK</strong>: tú aportas tu propia API key de
            Anthropic, OpenAI o Google. El coste de tokens va directamente a tu
            cuenta del proveedor.
          </p>
          <Link
            href="/admin/asistente-ia/configuracion"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-4 py-2 text-sm font-semibold text-white"
          >
            <Settings className="h-4 w-4" />
            Configurar ahora
          </Link>
        </div>
      ) : (
        <ChatLayout conversaciones={conversaciones} provider={cfg.provider} modelo={cfg.modelo} />
      )}
    </div>
  );
}

export default withTenantPage(AsistenteIAPage);
