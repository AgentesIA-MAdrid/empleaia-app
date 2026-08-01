"use client";

import { useEffect, useState } from "react";
import {
  decideNextState,
  decideOnFetchError,
  type ApiResponse,
  type VisualState,
} from "./transitions";

/**
 * Polling de /api/onboarding/status hasta llegar a "active" → redirect
 * a <slug>.<root>/login. La lógica de transiciones vive en
 * `./transitions.ts` (pura, testeable). Este componente solo conecta
 * la máquina al fetch y al render.
 */

const POLL_INTERVAL_MS = 2000;

export function ExitoCliente({ sessionId }: { sessionId: string }) {
  const [visual, setVisual] = useState<VisualState>("waiting");
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unknownStreak = 0;
    const startedAt = Date.now();

    async function poll() {
      if (stopped) return;
      try {
        const r = await fetch(
          `/api/onboarding/status?session_id=${encodeURIComponent(sessionId)}`,
          { cache: "no-store" },
        );
        if (!r.ok) {
          // 4xx/5xx persistente → tratamos como error terminal.
          setVisual("error");
          return;
        }
        const body = (await r.json()) as ApiResponse;
        if (stopped) return;

        if (body.status === "unknown") {
          console.warn(
            `[onboarding] poll #${unknownStreak + 1} devolvió status=unknown ` +
              `para session_id=${sessionId.slice(0, 24)}…`,
          );
        }

        const elapsed = Date.now() - startedAt;
        const decision = decideNextState(body, unknownStreak, elapsed);
        unknownStreak = decision.nextUnknownStreak;
        if (decision.slug) setTenantSlug(decision.slug);
        setVisual(decision.visual);

        if (decision.visual === "active" && decision.slug) {
          const root = window.location.host.split(".").slice(1).join(".");
          const port = window.location.port ? `:${window.location.port}` : "";
          const protocol = window.location.protocol;
          const target = `${protocol}//${decision.slug}.${root || window.location.host}${port}/login`;
          window.location.href = target;
          return;
        }

        if (decision.continuePolling) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        console.error("[onboarding] fetch falló:", err);
        if (!stopped) {
          setVisual(decideOnFetchError().visual);
        }
      }
    }

    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--muted)]">
      <main className="text-center max-w-md w-full">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-sm px-8 py-10">
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">Estamos preparando tu cuenta</h1>
          {visual === "waiting" || visual === "slow" ? (
            <>
              <div
                className="my-8 mx-auto w-10 h-10 rounded-full border-4 border-[var(--border)]"
                style={{
                  borderTopColor: "var(--primary)",
                  animation: "spin 1s linear infinite",
                }}
              />
              {visual === "waiting" ? (
                <p className="text-sm text-[var(--text-body)]">
                  Esto suele tardar entre 5 y 15 segundos. No cierres esta página.
                </p>
              ) : (
                <p className="text-sm text-[var(--warning-text)]">
                  Esto está tardando más de lo esperado. Seguimos intentándolo. Si
                  llevas más de 5 minutos aquí, contacta con soporte.
                </p>
              )}
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </>
          ) : visual === "active" ? (
            <p className="mt-4 text-sm text-[var(--text-body)]">
              Cuenta lista. Redirigiendo a <strong className="text-[var(--text-dark)]">{tenantSlug}</strong>…
            </p>
          ) : (
            <p className="mt-4 text-sm text-[var(--danger-text)]">
              Hubo un problema preparando tu cuenta. Recibirás un email cuando esté
              lista, o contacta con soporte si no te llega en 1 hora.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
