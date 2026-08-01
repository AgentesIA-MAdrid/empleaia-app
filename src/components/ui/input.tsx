import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-[var(--card)] px-3.5 py-2 text-sm text-[var(--color-text-dark,#0F172A)] shadow-[var(--shadow-soft-sm)]",
          "placeholder:text-[var(--color-text-muted,#94A3B8)]",
          "focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:shadow-[var(--shadow-focus-ring)]",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--bg-subtle,#F8FAFC)] disabled:shadow-none",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "transition-all duration-150",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
