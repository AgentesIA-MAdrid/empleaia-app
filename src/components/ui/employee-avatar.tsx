import * as React from "react";
import { cn } from "@/lib/utils";

const SIZE_CLASSES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-10 w-10 text-sm",
  xl: "h-12 w-12 text-base",
} as const;

type Size = keyof typeof SIZE_CLASSES;

/**
 * 5 colores rotativos empleaIA — emerald, amber, rose, sky, violet.
 * bg-color-100 + text-color-700 según el sistema.
 */
const PALETTE = [
  { bg: "bg-[var(--success-bg)]", text: "text-[var(--success-text)]" },
  { bg: "bg-[var(--warning-bg)]", text: "text-[var(--warning-text)]" },
  { bg: "bg-rose-100", text: "text-rose-700" },
  { bg: "bg-sky-100", text: "text-sky-700" },
  { bg: "bg-violet-100", text: "text-violet-700" },
] as const;

function pickColor(seed: string): (typeof PALETTE)[number] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function getInitials(nombre?: string | null, apellidos?: string | null): string {
  const n = (nombre ?? "").trim();
  const a = (apellidos ?? "").trim();
  if (!n && !a) return "?";
  return `${n[0] ?? ""}${a[0] ?? ""}`.toUpperCase() || (n[0] ?? "?").toUpperCase();
}

export interface EmployeeAvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  nombre?: string | null;
  apellidos?: string | null;
  size?: Size;
  /** override del seed — si no, usa nombre+apellidos */
  seed?: string;
  /** forzar variante primary (índigo empleaIA) */
  primary?: boolean;
}

export function EmployeeAvatar({
  nombre,
  apellidos,
  size = "sm",
  seed,
  primary = false,
  className,
  ...rest
}: EmployeeAvatarProps) {
  const initials = getInitials(nombre, apellidos);
  const color = primary
    ? null
    : pickColor(seed ?? `${nombre ?? ""}${apellidos ?? ""}`);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        SIZE_CLASSES[size],
        primary
          ? "bg-[var(--primary-light)] text-[var(--primary)]"
          : `${color!.bg} ${color!.text}`,
        className
      )}
      {...rest}
    >
      {initials}
    </span>
  );
}
