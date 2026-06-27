"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { LifeBuoy } from "lucide-react";
import { FeedbackModal } from "./feedback-modal";

// Botón flotante de feedback / abrir ticket de soporte. El gate
// (NEXT_PUBLIC_BETA_FEEDBACK) lo decide el layout en SERVIDOR (runtime), por eso
// este componente no lo re-comprueba: la var es build-time y el Dockerfile no la
// inyecta al build, así que un check en cliente daría siempre false. Badge rojo
// si hay respuesta sin ver.
//
// Se renderiza vía portal a document.body porque el layout monta este botón
// dentro de <main> → <div class="animate-fade-in">, y esa animación deja un
// `transform` permanente (fill-mode: both) que convierte ese div en el
// containing block del `position: fixed` → el FAB se anclaba al fondo del
// contenido scrolleable y había que hacer scroll para verlo. El portal lo saca
// de ese árbol y lo fija al viewport de verdad.
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [hasBadge, setHasBadge] = useState(false);
  const [mounted, setMounted] = useState(false);

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
    // setMounted habilita el portal sólo en cliente (createPortal necesita
    // document). El setState síncrono aquí es intencionado y se ejecuta una vez.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    // checkBadge hace setState DESPUÉS de un await (fetch), no de forma síncrona.
    checkBadge();
  }, [checkBadge]);

  if (!mounted) return null;

  return createPortal(
    <>
      <button
        onClick={() => { setOpen(true); setHasBadge(false); }}
        aria-label="Enviar feedback o abrir un ticket de soporte"
        title="¿Una idea o un problema? Abre un ticket"
        className="group fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary)] text-white shadow-lg shadow-[var(--primary)]/30 ring-1 ring-white/20 transition-all hover:scale-105 hover:shadow-xl active:scale-95"
      >
        <LifeBuoy className="h-6 w-6 transition-transform duration-500 group-hover:rotate-90" />
        {hasBadge && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-white bg-red-500" />
          </span>
        )}
      </button>
      <FeedbackModal open={open} onClose={() => setOpen(false)} onSent={checkBadge} />
    </>,
    document.body,
  );
}
