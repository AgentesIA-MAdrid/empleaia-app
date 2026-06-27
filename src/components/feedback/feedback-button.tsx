"use client";

import { useState, useEffect, useCallback } from "react";
import { MessageSquarePlus } from "lucide-react";
import { FeedbackModal } from "./feedback-modal";

// Botón flotante de feedback. Gate por NEXT_PUBLIC_BETA_FEEDBACK ("true").
// Badge rojo si hay tickets con respuesta sin ver (visto_por_user=false).
export function FeedbackButton() {
  const enabled = process.env.NEXT_PUBLIC_BETA_FEEDBACK === "true";
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
    // checkBadge hace setState DESPUÉS de un await (fetch), no de forma
    // síncrona: no provoca el cascading render que la regla intenta evitar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) checkBadge();
  }, [enabled, checkBadge]);

  if (!enabled) return null;

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
