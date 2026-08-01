import * as React from "react";
import { cn } from "@/lib/utils";

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** valor 0-100 */
  value: number;
  /** mostrar porcentaje a la derecha */
  showLabel?: boolean;
  /** override de la etiqueta. si no, "{value}%" */
  label?: React.ReactNode;
  /** alto de la barra */
  size?: "sm" | "md";
  /** color del fill — por defecto primary */
  tone?: "primary" | "success" | "warning" | "danger";
}

const FILL: Record<NonNullable<ProgressBarProps["tone"]>, string> = {
  primary: "bg-[var(--primary)]",
  success: "bg-[var(--success)]",
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--danger)]",
};

export function ProgressBar({
  value,
  showLabel = false,
  label,
  size = "sm",
  tone = "primary",
  className,
  ...rest
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const heightClass = size === "sm" ? "h-1" : "h-1.5";

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("flex items-center gap-2", className)}
      {...rest}
    >
      <div className={cn("flex-1 rounded-full bg-[var(--muted)] overflow-hidden", heightClass)}>
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", FILL[tone])}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-medium text-[var(--text-body)] tabular-nums shrink-0">
          {label ?? `${Math.round(clamped)}%`}
        </span>
      )}
    </div>
  );
}
