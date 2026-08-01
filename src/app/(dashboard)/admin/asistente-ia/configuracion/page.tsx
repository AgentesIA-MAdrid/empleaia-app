import { Bot, ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { prismaApp } from "@/lib/prisma";
import { ConfigForm } from "./config-form";

async function ConfiguracionIAPage() {
  const cfg = await prismaApp.iAConfiguracion.findUnique({
    where: { id: "default" },
    select: {
      provider: true,
      modelo: true,
      endpointUrl: true,
      systemPrompt: true,
      activa: true,
      ultimaPruebaAt: true,
      ultimaPruebaOk: true,
    },
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        href="/admin/asistente-ia"
        className="inline-flex items-center gap-1 text-sm text-[var(--color-text-body,#475569)] hover:text-[var(--primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al asistente
      </Link>

      <header className="flex items-start gap-3">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <Bot className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
            Configuración del asistente IA
          </h1>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            BYOK: tú aportas la API key. El coste va a tu cuenta del proveedor.
          </p>
        </div>
      </header>

      <div className="rounded-xl border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-6">
        <ConfigForm initial={cfg} />
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-5 text-sm text-[var(--text-body)] space-y-3">
        <h2 className="font-semibold text-[var(--text-dark)]">Cómo obtener una API key</h2>
        <ul className="space-y-2.5">
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--primary)] shrink-0" />
            <span>
              <strong>Anthropic (Claude)</strong> · Crea cuenta en{" "}
              <a className="text-[var(--primary)] hover:underline inline-flex items-center gap-0.5" href="https://console.anthropic.com" target="_blank" rel="noreferrer">
                console.anthropic.com <ExternalLink className="h-3 w-3" />
              </a>
              {" "}→ <em>API Keys</em> → <em>Create Key</em>. Modelos recomendados: <code className="bg-[var(--card)] px-1 py-0.5 rounded text-xs">claude-sonnet-4-6</code>, <code className="bg-[var(--card)] px-1 py-0.5 rounded text-xs">claude-haiku-4-5-20251001</code>.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--primary)] shrink-0" />
            <span>
              <strong>OpenAI (GPT)</strong> · Crea cuenta en{" "}
              <a className="text-[var(--primary)] hover:underline inline-flex items-center gap-0.5" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                platform.openai.com <ExternalLink className="h-3 w-3" />
              </a>
              {" "}→ <em>API keys</em> → <em>Create new secret key</em>. Modelos: <code className="bg-[var(--card)] px-1 py-0.5 rounded text-xs">gpt-4o</code>, <code className="bg-[var(--card)] px-1 py-0.5 rounded text-xs">gpt-4o-mini</code>.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--primary)] shrink-0" />
            <span>
              <strong>Google (Gemini)</strong> · Crea API key en{" "}
              <a className="text-[var(--primary)] hover:underline inline-flex items-center gap-0.5" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com/apikey <ExternalLink className="h-3 w-3" />
              </a>
              . Modelos: <code className="bg-[var(--card)] px-1 py-0.5 rounded text-xs">gemini-1.5-pro</code>, <code className="bg-[var(--card)] px-1 py-0.5 rounded text-xs">gemini-1.5-flash</code>.
            </span>
          </li>
        </ul>
        <p className="pt-2 text-xs text-[var(--text-muted)]">
          Tu API key se cifra con AES-256-GCM antes de guardarse en BD. No se muestra nunca tras
          guardarla — si la pierdes, simplemente vuelves a meter una nueva. El coste de tokens lo
          paga tu cuenta del proveedor; nosotros no facturamos por uso de IA.
        </p>
      </div>
    </div>
  );
}

export default withTenantPage(ConfiguracionIAPage);
