"use client";

import { openDocInNewTab } from "@/lib/documentos/url";

// Los documentos se guardan como data URL (base64) en BD. Los navegadores
// bloquean la navegación top-level a `data:` URLs, así que un `<a>` deja la
// pestaña en blanco. `openDocInNewTab` lo abre vía blob object URL.
export function AbrirDocumentoLink({ url }: { url: string }) {
  return (
    <button
      type="button"
      onClick={() => openDocInNewTab(url)}
      className="text-sm text-[var(--primary)] hover:underline"
    >
      Abrir documento en nueva pestaña →
    </button>
  );
}
