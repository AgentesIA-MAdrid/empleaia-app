import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--primary-light)] text-[var(--primary)]",
        secondary:
          "border-transparent bg-[var(--muted)] text-[var(--text-body)]",
        destructive:
          "border-transparent bg-[var(--danger-bg)] text-[var(--danger-text)]",
        outline:
          "border-[var(--border)] text-[var(--text-body)]",
        success:
          "border-transparent bg-[var(--success-bg)] text-[var(--success-text)]",
        warning:
          "border-transparent bg-[var(--warning-bg)] text-[var(--warning-text)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
