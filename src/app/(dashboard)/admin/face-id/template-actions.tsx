"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";

export function TemplateActions({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function reset() {
    if (!confirm("¿Borrar la plantilla biométrica? El empleado tendrá que volver a registrarse.")) return;
    setPending(true);
    try {
      const r = await fetch(`/api/face/template/${userId}`, { method: "DELETE" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      onClick={reset}
      disabled={pending}
      className="inline-flex items-center gap-1 text-xs text-[var(--danger-text)] hover:text-[var(--danger-text)] disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
      Resetear
    </button>
  );
}
