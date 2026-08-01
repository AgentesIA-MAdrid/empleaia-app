import type { LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";

interface ProximamenteCardProps {
  /** Título del módulo (ej. "Canal de denuncias"). */
  title: string;
  /** Descripción larga del módulo. */
  description: string;
  /** Plan que incluirá el módulo cuando esté disponible. */
  plan: "Starter" | "Pro" | "Enterprise" | "Todos los planes";
  /** Icono representativo (de lucide-react). */
  Icon: LucideIcon;
  /** Bullets opcionales de features del módulo. */
  bullets?: string[];
}

/**
 * Placeholder visual para módulos que están en el catálogo de billing
 * pero aún no implementados. Se muestra en `/admin/<modulo>/page.tsx`
 * mientras la implementación funcional llega en sesiones siguientes.
 */
export function ProximamenteCard({
  title,
  description,
  plan,
  Icon,
  bullets,
}: ProximamenteCardProps) {
  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
          <Icon className="h-6 w-6 text-[var(--primary)]" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
              {title}
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--warning-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--warning-text)]">
              <Sparkles className="h-3 w-3" />
              Próximamente
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
            {description}
          </p>
        </div>
      </header>

      <div className="rounded-xl border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] p-6">
        <h2 className="font-semibold text-[var(--color-text-dark,#0F172A)] mb-3">
          Lo que incluirá
        </h2>
        {bullets && bullets.length > 0 ? (
          <ul className="space-y-2 text-sm text-[var(--color-text-body,#475569)]">
            {bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[var(--primary)] shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-text-muted,#94A3B8)]">
            Estamos diseñando este módulo. Estará disponible en breve.
          </p>
        )}

        <div className="mt-6 rounded-lg bg-[var(--bg-subtle,#F8FAFC)] p-4 text-sm">
          <p className="text-[var(--color-text-body,#475569)]">
            <strong className="text-[var(--color-text-dark,#0F172A)]">Disponibilidad:</strong>{" "}
            {plan === "Todos los planes"
              ? "Cuando esté disponible, se incluirá en todos los planes"
              : `Cuando esté disponible, se incluirá en plan ${plan} y superiores`}
            .
          </p>
        </div>
      </div>
    </div>
  );
}
