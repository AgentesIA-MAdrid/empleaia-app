import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        success: "bg-[var(--success-bg)] text-[var(--success-text)]",
        warning: "bg-[var(--warning-bg)] text-[var(--warning-text)]",
        danger: "bg-[var(--danger-bg)] text-[var(--danger-text)]",
        neutral: "bg-[var(--muted)] text-[var(--text-body)]",
        info: "bg-sky-50 text-sky-800",
        primary: "bg-[var(--primary-light)] text-[var(--primary)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
);

const dotColor: Record<NonNullable<VariantProps<typeof pillVariants>["tone"]>, string> = {
  success: "bg-[var(--success)]",
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--danger)]",
  neutral: "bg-slate-400",
  info: "bg-sky-500",
  primary: "bg-[var(--primary)]",
};

export interface StatusPillProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
    VariantProps<typeof pillVariants> {
  label: React.ReactNode;
  showDot?: boolean;
}

export function StatusPill({
  tone = "neutral",
  label,
  showDot = true,
  className,
  ...props
}: StatusPillProps) {
  const t = tone ?? "neutral";
  return (
    <span className={cn(pillVariants({ tone: t }), className)} {...props}>
      {showDot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor[t])}
          aria-hidden="true"
        />
      )}
      <span>{label}</span>
    </span>
  );
}

/**
 * Mapeo de los estados de fichaje del sistema empleaIA. Acepta variantes
 * históricas en castellano o id internos.
 */
export type FichajeEstado =
  | "trabajando"
  | "en_pausa"
  | "sin_fichar"
  | "ausente"
  | "falta";

const FICHAJE_PRESETS: Record<FichajeEstado, { tone: NonNullable<VariantProps<typeof pillVariants>["tone"]>; label: string }> = {
  trabajando: { tone: "success", label: "En línea" },
  en_pausa: { tone: "warning", label: "En pausa" },
  sin_fichar: { tone: "neutral", label: "Sin fichar" },
  ausente: { tone: "danger", label: "Ausente" },
  falta: { tone: "danger", label: "Falta" },
};

export interface FichajeStatusPillProps
  extends Omit<StatusPillProps, "tone" | "label"> {
  estado: FichajeEstado;
  label?: React.ReactNode;
}

export function FichajeStatusPill({ estado, label, ...rest }: FichajeStatusPillProps) {
  const preset = FICHAJE_PRESETS[estado] ?? FICHAJE_PRESETS.sin_fichar;
  return <StatusPill tone={preset.tone} label={label ?? preset.label} {...rest} />;
}
