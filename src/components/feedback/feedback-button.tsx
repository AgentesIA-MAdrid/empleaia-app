"use client";

import { useState, useEffect, useCallback } from "react";
import { MessageSquarePlus } from "lucide-react";
import { FeedbackModal } from "./feedback-modal";

// Botón flotante de feedback. El gate (NEXT_PUBLIC_BETA_FEEDBACK) lo decide el
// layout en SERVIDOR (runtime), por eso este componente no lo re-comprueba: la
// var es build-time y el Dockerfile no la inyecta al build, así que un check en
// cliente daría siempre false. Badge rojo si hay respuesta sin ver.
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [hasBadge, setHasBadge] = useState(false);

  const checkBadge = useCallback(async () => {
    try {
      const res = await fetch("/api/feedback/my-tickets");
      if (!res.ok) return;
      const tickets = (await res.json()) as { visto_por_user: boolean }[];
      setHasBadge(tickets.some((t) => t.visto_por_user === false));
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    // checkBadge hace setState DESPUÉS de un await (fetch), no de forma síncrona.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkBadge();
  }, [checkBadge]);

  return (
    <>
      <button
        onClick={() => { setOpen(true); setHasBadge(false); }}
        aria-label="Enviar feedback"
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary)] text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        <MessageSquarePlus className="h-5 w-5" />
        {hasBadge && (
          <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white bg-red-500" />
        )}
      </button>
      <FeedbackModal open={open} onClose={() => setOpen(false)} onSent={checkBadge} />
    </>
  );
}
