"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";

interface InitialConfig {
  provider: "anthropic" | "openai" | "google";
  modelo: string;
  endpointUrl: string | null;
  systemPrompt: string | null;
  activa: boolean;
  ultimaPruebaAt: Date | string | null;
  ultimaPruebaOk: boolean | null;
}

const INPUT =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20";

const MODELOS_DEFAULT: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-7"],
  openai: ["gpt-4o", "gpt-4o-mini", "o1-mini"],
  google: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-exp"],
};

export function ConfigForm({ initial }: { initial: InitialConfig | null }) {
  const router = useRouter();
  const [provider, setProvider] = useState<InitialConfig["provider"]>(
    initial?.provider ?? "anthropic",
  );
  const [modelo, setModelo] = useState(initial?.modelo ?? MODELOS_DEFAULT.anthropic[0]);
  const [apiKey, setApiKey] = useState("");
  const [endpointUrl, setEndpointUrl] = useState(initial?.endpointUrl ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
  const [activa, setActiva] = useState(initial?.activa ?? true);
  const [pending, setPending] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaveOk(false);
    try {
      const r = await fetch("/api/ia/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          modelo,
          apiKey: apiKey || undefined,
          endpointUrl: endpointUrl || undefined,
          systemPrompt: systemPrompt || undefined,
          activa,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setSaveOk(true);
      setApiKey("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setPending(false);
    }
  }

  async function probar() {
    setTestingConn(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/ia/test", { method: "POST" });
      const data = await r.json();
      if (r.ok) {
        setTestResult({ ok: true, msg: `Conectado a ${data.modelo}` });
      } else {
        setTestResult({ ok: false, msg: data.error ?? `HTTP ${r.status}` });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : "Error" });
    } finally {
      setTestingConn(false);
    }
  }

  async function borrar() {
    if (!confirm("¿Borrar la configuración del asistente IA? La API key se eliminará permanentemente.")) return;
    setPending(true);
    try {
      const r = await fetch("/api/ia/config", { method: "DELETE" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={guardar} className="grid gap-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Proveedor</span>
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as InitialConfig["provider"];
              setProvider(p);
              setModelo(MODELOS_DEFAULT[p][0]);
            }}
            className={INPUT}
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
            <option value="google">Google (Gemini)</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Modelo</span>
          <input
            list="modelos-sugeridos"
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            className={INPUT}
            required
          />
          <datalist id="modelos-sugeridos">
            {MODELOS_DEFAULT[provider].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      </div>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium">
          API Key{" "}
          {initial && (
            <span className="text-[var(--text-muted)] font-normal">
              (opcional — deja vacío para conservar la actual)
            </span>
          )}
        </span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          placeholder={initial ? "•••••••• (se conserva si lo dejas vacío)" : "sk-ant-... / sk-... / AIza..."}
          className={INPUT}
        />
        <span className="text-xs text-[var(--text-muted)]">
          Se cifra con AES-256-GCM antes de guardarse. No se muestra nunca de vuelta.
        </span>
      </label>

      <details className="rounded-lg border bg-[var(--muted)]">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-[var(--text-body)]">
          Opciones avanzadas
        </summary>
        <div className="p-4 border-t bg-[var(--card)] grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">URL del endpoint (opcional)</span>
            <input
              type="url"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="Ej. https://my-org.openai.azure.com (Azure OpenAI)"
              className={INPUT}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">System prompt personalizado (opcional)</span>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={5}
              maxLength={10_000}
              placeholder="Sobreescribe las instrucciones por defecto del asistente."
              className="w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] resize-y"
            />
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
            Asistente activo (los managers pueden usarlo)
          </label>
        </div>
      </details>

      {testResult && (
        <div
          className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${
            testResult.ok
              ? "border-[var(--success-bg)] bg-[var(--success-bg)] text-[var(--success-text)]"
              : "border-[var(--danger-bg)] bg-[var(--danger-bg)] text-[var(--danger-text)]"
          }`}
        >
          {testResult.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <span>{testResult.msg}</span>
        </div>
      )}

      {saveOk && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--success-bg)] bg-[var(--success-bg)] px-3 py-2.5 text-sm text-[var(--success-text)]">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          Configuración guardada.
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--danger-bg)] bg-[var(--danger-bg)] px-3 py-2.5 text-sm text-[var(--danger-text)]">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar configuración
        </button>
        {initial && (
          <button
            type="button"
            onClick={probar}
            disabled={testingConn || pending}
            className="inline-flex items-center justify-center gap-2 rounded-lg border bg-[var(--card)] hover:bg-[var(--muted)] px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          >
            {testingConn && <Loader2 className="h-4 w-4 animate-spin" />}
            Probar conexión
          </button>
        )}
        {initial && (
          <button
            type="button"
            onClick={borrar}
            disabled={pending}
            className="ml-auto inline-flex items-center gap-1.5 text-sm text-[var(--danger-text)] hover:text-[var(--danger-text)] disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Borrar configuración
          </button>
        )}
      </div>
    </form>
  );
}
