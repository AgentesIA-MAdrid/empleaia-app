"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Boxes, Lock, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface Integracion {
  id: string; slug: string; nombre: string; descripcion: string;
  categoria: string; logoUrl: string | null;
  instalada: boolean;
}

const CAT_LABEL: Record<string, string> = {
  comunicacion: "Comunicación",
  nominas: "Nóminas",
  calendario: "Calendario",
  rrhh: "RRHH",
  contabilidad: "Contabilidad",
};

export default function MarketplacePage() {
  const { toast } = useToast();
  const [integraciones, setIntegraciones] = useState<Integracion[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/marketplace");
      if (r.status === 402) { setUnavailable(true); return; }
      const d = await r.json();
      setIntegraciones(d.integraciones ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const toggleIntegracion = async (it: Integracion) => {
    if (it.instalada) {
      const r = await fetch(`/api/marketplace?slug=${encodeURIComponent(it.slug)}`, { method: "DELETE" });
      if (r.ok) { toast({ title: "Desinstalada" }); await fetchAll(); }
    } else {
      const r = await fetch("/api/marketplace", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: it.slug, configuracion: {} }),
      });
      if (r.ok) { toast({ title: "Instalada", description: "Configura los detalles desde su panel propio cuando estén disponibles." }); await fetchAll(); }
    }
  };

  if (unavailable) {
    return (
      <div className="p-6">
        <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
          <CardContent className="pt-4 pb-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-[var(--warning-text)] shrink-0 mt-0.5" />
            <div className="flex-1"><p className="text-sm font-semibold text-[var(--warning-text)]">Marketplace — plan Pro o superior</p></div>
            <Link href="/admin/planes"><Button size="sm">Ver planes</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const porCategoria = integraciones.reduce<Record<string, Integracion[]>>((acc, i) => {
    (acc[i.categoria] ??= []).push(i);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center"><Boxes className="h-5 w-5 text-[var(--primary)]" /></div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-dark)]">Marketplace de integraciones</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Conecta empleaIA con tus herramientas favoritas</p>
        </div>
      </div>

      <Card className="border-[var(--warning-bg)] bg-[var(--warning-bg)]">
        <CardContent className="pt-3 pb-3 text-xs text-[var(--warning-text)]">
          <strong>Vista previa:</strong> el catálogo está disponible. La activación marca la integración como &quot;conectada&quot; en tu cuenta. La sincronización real con cada servicio se irá desplegando.
        </CardContent>
      </Card>

      {loading ? <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /> :
        Object.entries(porCategoria).map(([cat, list]) => (
          <div key={cat} className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide">{CAT_LABEL[cat] ?? cat}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((i) => (
                <Card key={i.id} className={i.instalada ? "border-[var(--success-bg)]" : ""}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[var(--text-dark)]">{i.nombre}</p>
                        <p className="text-sm text-[var(--text-body)] mt-0.5 line-clamp-2">{i.descripcion}</p>
                      </div>
                      {i.instalada && <CheckCircle2 className="h-5 w-5 text-[var(--success-text)] shrink-0" />}
                    </div>
                    <Button size="sm" variant={i.instalada ? "outline" : "default"} className="mt-3 w-full" onClick={() => toggleIntegracion(i)}>
                      {i.instalada ? "Desinstalar" : "Instalar"}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))
      }
    </div>
  );
}
