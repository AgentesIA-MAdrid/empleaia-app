"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Ticket, X } from "lucide-react";

const DISMISS_KEY = "empleaia.new-tickets-dismissed";
const POLL_MS = 60_000;

interface PendingInfo {
  count: number;
  latestCreatedAt: string | null;
}

// Banner para super-admin: tickets de soporte sin atender ('nuevo'). El gate es
// el propio endpoint (403 → se apaga). Se oculta con la X (localStorage) y
// reaparece si entra un ticket más nuevo.
export function NewTicketsBanner() {
  const [pending, setPending] = useState<PendingInfo | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [dismissedAt, setDismissedAt] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem(DISMISS_KEY),
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/feedback/pending", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setEnabled(false);
        return;
      }
      if (res.ok) setPending(await res.json());
    } catch {
      /* reintenta en el siguiente tick */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // load() hace setState tras un await (fetch), no de forma síncrona.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [enabled, load]);

  const dismiss = () => {
    if (!pending?.latestCreatedAt) return;
    localStorage.setItem(DISMISS_KEY, pending.latestCreatedAt);
    setDismissedAt(pending.latestCreatedAt);
  };

  if (!enabled || !pending || pending.count === 0) return null;
  if (dismissedAt && pending.latestCreatedAt && pending.latestCreatedAt <= dismissedAt) return null;

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm text-amber-900" role="status">
      <Ticket className="h-4 w-4 shrink-0" />
      <span className="font-medium">{pending.count === 1 ? "1 ticket nuevo" : `${pending.count} tickets nuevos`}</span>
      <span className="text-amber-700">— pendiente de revisar</span>
      <Link href="/admin/feedback" className="ml-auto font-medium underline">Ver tickets</Link>
      <button onClick={dismiss} aria-label="Ocultar" className="text-amber-500 hover:text-amber-800"><X className="h-4 w-4" /></button>
    </div>
  );
}
