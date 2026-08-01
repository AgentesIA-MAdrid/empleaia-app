import { verifyFeedbackActionToken } from "@/lib/feedback/action-token";
import { getTicketById, getTicketOrgName, listMessages } from "@/lib/feedback/repository";

export const dynamic = "force-dynamic";

// Página pública de "Resolver con Claude" desde el email de ticket nuevo. SIN
// sesión: el token HMAC del enlace es la autorización. La mutación va en el POST
// del form a /api/feedback-action/resolve (no en este GET) para que un prefetch
// del escáner de correo no gaste el token single-use.

const TIPO_LABEL: Record<string, string> = { bug: "Bug", mejora: "Mejora", pregunta: "Pregunta" };

const RESULT_COPY: Record<string, { title: string; body: string; tone: "ok" | "warn" | "error" }> = {
  ok: { title: "Job encolado", body: "Claudia está resolviendo el ticket en un worktree aislado. Recibirás un email con el resultado al terminar.", tone: "ok" },
  active: { title: "Ya estaba en marcha", body: "Ya había un job en curso para este ticket. No hace falta relanzarlo.", tone: "ok" },
  used: { title: "Enlace ya utilizado", body: "Este enlace es de un solo uso y ya se usó. Relánzalo desde el panel de administración.", tone: "warn" },
  notfound: { title: "Ticket no encontrado", body: "El ticket ya no existe (puede haberse borrado).", tone: "warn" },
  invalid: { title: "Enlace inválido o caducado", body: "El enlace no es válido o ha caducado (vencen a los 7 días). Ábrelo desde el panel.", tone: "error" },
  rate: { title: "Demasiados intentos", body: "Has hecho demasiadas peticiones seguidas. Espera un momento e inténtalo de nuevo.", tone: "error" },
};

const DOT: Record<string, string> = { ok: "bg-[var(--success)]", warn: "bg-[var(--warning)]", error: "bg-[var(--danger)]" };

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--muted)] p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">{children}</div>
    </main>
  );
}

interface PageProps {
  searchParams: Promise<{ token?: string; r?: string }>;
}

export default async function ResolverConClaudePage({ searchParams }: PageProps) {
  const { token, r } = await searchParams;

  if (r) {
    const copy = RESULT_COPY[r] ?? RESULT_COPY.invalid;
    return (
      <Card>
        <span className={`mb-3 inline-block h-3 w-3 rounded-full ${DOT[copy.tone]}`} />
        <h1 className="text-xl font-bold text-[var(--text-dark)]">{copy.title}</h1>
        <p className="mt-2 text-[var(--text-body)]">{copy.body}</p>
      </Card>
    );
  }

  const payload = token ? verifyFeedbackActionToken(token) : null;
  if (!payload) {
    const copy = RESULT_COPY.invalid;
    return (
      <Card>
        <span className="mb-3 inline-block h-3 w-3 rounded-full bg-[var(--danger)]" />
        <h1 className="text-xl font-bold text-[var(--text-dark)]">{copy.title}</h1>
        <p className="mt-2 text-[var(--text-body)]">{copy.body}</p>
      </Card>
    );
  }

  const ticket = await getTicketById(payload.ticket_id);
  if (!ticket) {
    const copy = RESULT_COPY.notfound;
    return (
      <Card>
        <span className="mb-3 inline-block h-3 w-3 rounded-full bg-[var(--warning)]" />
        <h1 className="text-xl font-bold text-[var(--text-dark)]">{copy.title}</h1>
        <p className="mt-2 text-[var(--text-body)]">{copy.body}</p>
      </Card>
    );
  }

  const orgName = await getTicketOrgName(ticket.org_id);
  const desc = ticket.descripcion.length > 240 ? `${ticket.descripcion.slice(0, 240)}…` : ticket.descripcion;
  const messages = await listMessages(ticket.id).catch(() => []);

  return (
    <Card>
      <h1 className="text-xl font-bold text-[var(--text-dark)]">Resolver con Claudia</h1>
      <p className="mt-2 text-sm text-[var(--text-body)]">
        Vas a encolar un job para que Claudia analice este ticket en un worktree aislado y, si procede, abra un PR
        (nunca lo mergea). Recibirás el resultado por email.
      </p>

      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--muted)]/60 p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded-full bg-[var(--primary-light)] px-2 py-0.5 text-xs font-medium text-[var(--primary)]">
            {TIPO_LABEL[ticket.tipo] ?? ticket.tipo}
          </span>
          <span className="text-xs text-[var(--text-muted)]">{orgName || "—"}</span>
        </div>
        <p className="text-sm text-[var(--text-body)]">{desc}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Página: {ticket.pagina}</p>
      </div>

      {messages.length > 0 && (
        <div className="mt-4 space-y-2">
          <span className="text-xs font-medium text-[var(--text-muted)]">Conversación</span>
          {messages.map((m) => (
            <div key={m.id} className="rounded-lg bg-[var(--muted)] px-3 py-2 text-sm">
              <span className="mb-0.5 block text-xs font-medium text-[var(--text-muted)]">
                {m.is_ai ? "Claudia" : m.autor === "admin" ? "Equipo" : "Usuario"}
                {m.internal && <span className="ml-1 rounded bg-slate-200 px-1 text-[10px]">interno</span>}
              </span>
              <span className="text-[var(--text-body)]">{m.cuerpo.length > 300 ? `${m.cuerpo.slice(0, 300)}…` : m.cuerpo}</span>
            </div>
          ))}
        </div>
      )}

      <form method="post" action="/api/feedback-action/resolve" className="mt-4 space-y-2">
        <input type="hidden" name="token" value={token} />
        <label htmlFor="comment" className="block text-sm font-medium text-[var(--text-body)]">
          Instrucciones para Claudia <span className="font-normal text-[var(--text-muted)]">(opcional, internas)</span>
        </label>
        <textarea
          id="comment"
          name="comment"
          rows={4}
          maxLength={2000}
          placeholder="P. ej.: el bug solo pasa en móvil; revisa primero el componente X…"
          className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
        />
        <button
          type="submit"
          className="w-full rounded-lg bg-[var(--primary)] px-4 py-2.5 font-medium text-white hover:opacity-90"
        >
          Encolar Resolver con Claudia
        </button>
      </form>
    </Card>
  );
}
