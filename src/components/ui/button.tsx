import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Variants alineadas con el lenguaje Stitch de la landing (.btn-primary,
// .btn-secondary, .btn-ghost). Versión MODERADA para app de 8h:
//   - default: gradient Royal Blue→Navy + soft 3D shadow + glow primary
//     en hover (lift 1px). Sin scale agresivo.
//   - outline: glassmorphism sutil con border primary.
//   - resto: planos.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // .btn-primary — gradient + soft 3D (versión app, sin lift agresivo)
        default:
          "text-white bg-gradient-to-b from-[var(--primary-lighter)] via-[var(--primary)] to-[var(--primary-dark)] shadow-[var(--shadow-primary-glow)] hover:-translate-y-[1px] hover:shadow-[var(--shadow-primary-glow),0_12px_24px_-8px_rgba(37,99,235,0.4)] active:translate-y-0",
        destructive:
          "text-white bg-gradient-to-b from-red-500 to-red-700 shadow-sm hover:shadow-md active:translate-y-0",
        // .btn-secondary — glass sutil
        outline:
          "border border-[var(--primary)]/30 bg-[var(--card)]/80 text-[var(--primary-dark)] backdrop-blur-sm shadow-[var(--shadow-soft-sm)] hover:border-[var(--primary)] hover:bg-[var(--card)] hover:shadow-[var(--shadow-soft)]",
        secondary:
          "bg-[var(--bg-subtle,#F8FAFC)] text-[var(--color-text-dark,#0F172A)] hover:bg-[var(--muted)]",
        // .btn-ghost — plano
        ghost:
          "font-medium text-[var(--color-text-dark,#0F172A)] hover:bg-[var(--bg-subtle,#F8FAFC)]",
        "ghost-primary":
          "font-medium text-[var(--primary)] hover:bg-[var(--primary-light)]",
        link:
          "font-medium text-[var(--primary)] underline-offset-4 hover:underline",
      },
      size: {
        // sm = h-9 px-4 (densidad media)
        sm: "h-9 px-4 text-sm",
        // default = .btn-primary de landing: py-3 px-5 text-sm => h-11
        default: "h-11 px-5 text-sm",
        md: "h-11 px-5 text-sm",
        // lg = más grande para CTAs hero (px-8 py-4)
        lg: "h-12 px-8 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild: _asChild, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
