"use client";

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONO = {
  default: Info,
  success: CheckCircle2,
  destructive: XCircle,
  warning: AlertTriangle,
} as const;

const COLOR_ICONO = {
  default: "text-[var(--primary)]",
  success: "text-[var(--success)]",
  destructive: "text-[var(--danger)]",
  warning: "text-[var(--warning)]",
} as const;

type Variante = keyof typeof ICONO;

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const v = (variant ?? "default") as Variante;
        const Icono = ICONO[v] ?? Info;
        return (
          <Toast key={id} variant={variant} {...props}>
            <Icono className={cn("mt-0.5 h-5 w-5 shrink-0", COLOR_ICONO[v] ?? COLOR_ICONO.default)} />
            <div className="grid flex-1 gap-0.5">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
