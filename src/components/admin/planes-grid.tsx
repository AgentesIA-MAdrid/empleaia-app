"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  PLAN_PRICING,
  PLAN_ORDER,
  MIN_BILLABLE_SEATS,
  formatEuros,
  computeMonthlyCostCents,
  type PlanKey,
} from "@/lib/billing/plan-pricing";

interface PlanesGridProps {
  currentPlan: PlanKey | null;
  empleadosActivos: number;
}

type CtaState = "actual" | "upgrade" | "downgrade" | "elegir";

function ctaStateFor(currentPlan: PlanKey | null, target: PlanKey): CtaState {
  if (!currentPlan) return "elegir";
  if (currentPlan === target) return "actual";
  const idxCurrent = PLAN_ORDER.indexOf(currentPlan);
  const idxTarget = PLAN_ORDER.indexOf(target);
  return idxTarget > idxCurrent ? "upgrade" : "downgrade";
}

export function PlanesGrid({ currentPlan, empleadosActivos }: PlanesGridProps) {
  const { toast } = useToast();
  const [pending, setPending] = useState<PlanKey | null>(null);
  const [confirmingPlan, setConfirmingPlan] = useState<PlanKey | null>(null);

  async function startCheckout(planKey: PlanKey) {
    setPending(planKey);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      window.location.href = body.url as string;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error iniciando el pago";
      toast({ title: "No se pudo abrir el pago", description: msg, variant: "destructive" });
    } finally {
      setPending(null);
      setConfirmingPlan(null);
    }
  }

  return (
    <>
      <div className="rounded-lg border border-[var(--warning-bg)] bg-[var(--warning-bg)] p-4 mb-6 flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5 w-8 h-8 rounded-full bg-[var(--warning-bg)] flex items-center justify-center">
          <span className="font-bold text-[var(--warning-text)] text-sm">{MIN_BILLABLE_SEATS}</span>
        </div>
        <div className="flex-1 text-sm">
          <p className="font-semibold text-[var(--warning-text)]">
            Facturación mínima: {MIN_BILLABLE_SEATS} usuarios
          </p>
          <p className="text-[var(--warning-text)] mt-0.5">
            Todos los planes facturan un mínimo de {MIN_BILLABLE_SEATS} usuarios al mes
            independientemente de tus empleados activos. Si tienes menos, igualmente
            se aplica este mínimo.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {PLAN_ORDER.map((key) => {
          const plan = PLAN_PRICING[key];
          const state = ctaStateFor(currentPlan, key);
          return (
            <div
              key={key}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-[var(--card)] p-6 transition-shadow",
                plan.popular
                  ? "border-[var(--primary)] ring-1 ring-[var(--primary)] shadow-sm"
                  : "border-[var(--color-border,#E2E8F0)]",
              )}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-[var(--primary)] px-3 py-1 text-xs font-semibold text-white shadow-sm">
                  <Sparkles className="h-3.5 w-3.5" />
                  Más popular
                </div>
              )}

              {state === "actual" && (
                <div className="absolute -top-3 right-4 inline-flex items-center rounded-full bg-[var(--success-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--success-text)] ring-1 ring-emerald-200">
                  Plan actual
                </div>
              )}

              <div className="mb-4">
                <h3 className="text-lg font-bold text-[var(--color-text-dark,#0F172A)]">
                  {plan.displayName}
                </h3>
                <p className="text-sm text-[var(--color-text-body,#475569)] mt-1">
                  {plan.tagline}
                </p>
              </div>

              <div className="mb-4">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight text-[var(--color-text-dark,#0F172A)]">
                    {formatEuros(plan.pricePerEmployeeCents)}
                  </span>
                  <span className="text-sm text-[var(--color-text-body,#475569)]">
                    /usuario/mes
                  </span>
                </div>
                <div className="mt-3 rounded-md bg-[var(--muted)] px-3 py-2">
                  <p className="text-xs font-medium text-[var(--text-body)]">
                    Importe mínimo
                  </p>
                  <p className="text-base font-bold text-[var(--color-text-dark,#0F172A)]">
                    {formatEuros(plan.monthlyMinimumCents, { compact: true })}/mes
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    {MIN_BILLABLE_SEATS} usuarios mínimo
                  </p>
                </div>
              </div>

              <ul className="space-y-2 flex-1">
                {plan.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-body,#475569)]">
                    <Check className="h-4 w-4 text-[var(--success)] shrink-0 mt-0.5" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                {state === "actual" ? (
                  <Button variant="outline" className="w-full" disabled>
                    Plan activo
                  </Button>
                ) : (
                  <Button
                    variant={plan.popular || state === "upgrade" ? "default" : "outline"}
                    className="w-full"
                    onClick={() => setConfirmingPlan(key)}
                    disabled={pending !== null}
                  >
                    {pending === key ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Abriendo pago…
                      </>
                    ) : state === "elegir" ? (
                      `Elegir ${plan.displayName}`
                    ) : state === "upgrade" ? (
                      `Mejorar a ${plan.displayName}`
                    ) : (
                      `Bajar a ${plan.displayName}`
                    )}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={confirmingPlan !== null}
        onOpenChange={(open) => !open && setConfirmingPlan(null)}
      >
        <DialogContent>
          {confirmingPlan && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {ctaStateFor(currentPlan, confirmingPlan) === "downgrade"
                    ? `Bajar a plan ${PLAN_PRICING[confirmingPlan].displayName}`
                    : ctaStateFor(currentPlan, confirmingPlan) === "elegir"
                      ? `Activar plan ${PLAN_PRICING[confirmingPlan].displayName}`
                      : `Mejorar a plan ${PLAN_PRICING[confirmingPlan].displayName}`}
                </DialogTitle>
                <DialogDescription>
                  {currentPlan ? (
                    <>
                      Vas a cambiar de{" "}
                      <strong>{PLAN_PRICING[currentPlan].displayName}</strong>
                      {" → "}
                      <strong>{PLAN_PRICING[confirmingPlan].displayName}</strong>
                      .
                    </>
                  ) : (
                    <>
                      Vas a activar el plan{" "}
                      <strong>{PLAN_PRICING[confirmingPlan].displayName}</strong>
                      .
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-lg bg-[var(--bg-subtle,#F8FAFC)] p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-body,#475569)]">Precio por empleado</span>
                  <span className="font-semibold text-[var(--color-text-dark,#0F172A)]">
                    {formatEuros(PLAN_PRICING[confirmingPlan].pricePerEmployeeCents)}/mes
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-body,#475569)]">Empleados activos</span>
                  <span className="font-semibold text-[var(--color-text-dark,#0F172A)]">
                    {empleadosActivos}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-body,#475569)]">
                    Mínimo facturable ({MIN_BILLABLE_SEATS} usuarios)
                  </span>
                  <span className="font-semibold text-[var(--color-text-dark,#0F172A)]">
                    {formatEuros(PLAN_PRICING[confirmingPlan].monthlyMinimumCents, { compact: true })}/mes
                  </span>
                </div>
                <div className="border-t border-[var(--color-border,#E2E8F0)] pt-2 flex justify-between">
                  <span className="font-medium text-[var(--color-text-dark,#0F172A)]">
                    Tu factura mensual
                  </span>
                  <span className="font-bold text-[var(--primary)]">
                    {formatEuros(
                      computeMonthlyCostCents(confirmingPlan, empleadosActivos),
                    )}
                    /mes
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-muted,#94A3B8)] pt-1">
                  El cambio es inmediato. Stripe prorratea la diferencia con tu
                  ciclo de facturación actual. IVA no incluido.
                </p>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmingPlan(null)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => startCheckout(confirmingPlan)}
                  disabled={pending !== null}
                >
                  {pending !== null ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Abriendo pago…
                    </>
                  ) : (
                    "Continuar al pago"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
