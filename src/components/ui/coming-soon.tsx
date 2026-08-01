"use client";

import { Clock } from "lucide-react";
import React from "react";

interface ComingSoonProps {
  feature: string;
  description?: string;
  icon?: React.ReactNode;
}

export function ComingSoon({ feature, description, icon }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
      <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
        {icon ?? <Clock className="h-10 w-10 text-indigo-400" />}
      </div>
      <div className="inline-flex items-center gap-2 bg-[var(--warning-bg)] border border-[var(--warning-bg)] rounded-full px-4 py-1.5 mb-4">
        <span className="w-2 h-2 bg-[var(--warning)] rounded-full animate-pulse" />
        <span className="text-sm font-medium text-[var(--warning-text)]">Próximamente</span>
      </div>
      <h1 className="text-2xl font-bold text-[var(--text-dark)] mb-2">{feature}</h1>
      {description && (
        <p className="text-[var(--text-muted)] max-w-md text-sm">{description}</p>
      )}
      <p className="text-xs text-[var(--text-muted)] mt-4">
        Estamos trabajando en esta funcionalidad. Estará disponible pronto.
      </p>
    </div>
  );
}
