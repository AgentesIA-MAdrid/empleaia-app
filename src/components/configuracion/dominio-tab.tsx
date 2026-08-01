"use client";

/**
 * Tab "Dominio" en /admin/configuracion. Plan Fase 6 §4.
 *
 * Gateada por feature `dominio_personalizado`. Si OFF: UpsellCTA.
 *
 * Flow:
 *  1. Estado actual (GET).
 *  2. Form para registrar/cambiar dominio (POST → genera token).
 *  3. Instrucciones DNS + botón "Verificar" (POST /verify).
 *  4. Botón "Eliminar dominio".
 */

import { useEffect, useState, useCallback } from "react";
import { Globe, CheckCircle2, AlertTriangle, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { FeatureGateClient } from "@/components/feature-gate-client";
import { UpsellCTA } from "@/components/upsell-cta";

type Estado = {
  domain: string | null;
  verified: boolean;
  verifyRecord: { host: string; type: string; value: string } | null;
};

export function DominioTab() {
  return (
    <FeatureGateClient
      feature="dominio_personalizado"
      fallback={
        <div className="space-y-4">
          <UpsellCTA feature="dominio_personalizado" />
          <p className="text-sm text-[var(--text-muted)] text-center">
            Conecta un dominio propio (e.g. fichaje.tuempresa.com). Disponible
            con plan Pro o Enterprise.
          </p>
        </div>
      }
    >
      <DominioTabInner />
    </FeatureGateClient>
  );
}

function DominioTabInner() {
  const { toast } = useToast();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [loading, setLoading] = useState(true);
  const [nuevo, setNuevo] = useState("");
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/configuracion/dominio");
      if (r.ok) {
        setEstado((await r.json()) as Estado);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function registrar() {
    setBusy(true);
    try {
      const r = await fetch("/api/configuracion/dominio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: nuevo }),
      });
      const body = await r.json();
      if (r.ok) {
        setEstado(body as Estado);
        setNuevo("");
        toast({ title: "Dominio registrado. Configura el TXT y verifica." });
      } else {
        toast({
          title: body.error === "domain_already_in_use" ? "Dominio ya en uso" : "Dominio inválido",
          variant: "destructive",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function verificar() {
    setBusy(true);
    try {
      const r = await fetch("/api/configuracion/dominio/verify", { method: "POST" });
      const body = await r.json();
      if (r.ok) {
        toast({ title: "Dominio verificado correctamente." });
        await cargar();
      } else {
        toast({
          title:
            body.error === "txt_record_not_found"
              ? "TXT no encontrado todavía"
              : "Error de verificación",
          description: body.hint ?? body.reason,
          variant: "destructive",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function eliminar() {
    if (!confirm("¿Eliminar el dominio personalizado? Tus usuarios volverán al subdominio default.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/configuracion/dominio", { method: "DELETE" });
      if (r.ok) {
        setEstado({ domain: null, verified: false, verifyRecord: null });
        toast({ title: "Dominio eliminado." });
      }
    } finally {
      setBusy(false);
    }
  }

  function copiar(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copiado al portapapeles" });
  }

  if (loading) {
    return <div className="h-32 animate-pulse rounded bg-[var(--muted)]" />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-indigo-600" /> Dominio personalizado
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!estado?.domain && (
            <>
              <p className="text-sm text-[var(--text-muted)]">
                Conecta un dominio propio para que tus empleados accedan en{" "}
                <code>fichaje.tuempresa.com</code> en vez del subdominio default.
              </p>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label>Dominio</Label>
                  <Input
                    className="mt-1"
                    placeholder="fichaje.tuempresa.com"
                    value={nuevo}
                    onChange={(e) => setNuevo(e.target.value)}
                  />
                </div>
                <Button onClick={registrar} disabled={!nuevo || busy}>
                  Registrar
                </Button>
              </div>
            </>
          )}

          {estado?.domain && !estado.verified && (
            <>
              <div className="flex items-center gap-2 text-[var(--warning-text)] text-sm">
                <AlertTriangle className="h-4 w-4" />
                <span>
                  Dominio <strong>{estado.domain}</strong> registrado. Pendiente
                  de verificación DNS.
                </span>
              </div>
              {estado.verifyRecord && (
                <div className="bg-[var(--muted)] border border-[var(--border)] rounded-lg p-4 space-y-2 text-sm">
                  <p className="font-medium text-[var(--text-dark)]">
                    Añade este registro TXT en tu proveedor DNS:
                  </p>
                  <div className="grid grid-cols-[auto,1fr,auto] gap-2 items-center">
                    <span className="text-[var(--text-muted)]">Host:</span>
                    <code className="font-mono text-xs bg-[var(--card)] px-2 py-1 rounded border">
                      {estado.verifyRecord.host}
                    </code>
                    <Button variant="ghost" size="sm" onClick={() => copiar(estado.verifyRecord!.host)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-[var(--text-muted)]">Tipo:</span>
                    <code className="font-mono text-xs bg-[var(--card)] px-2 py-1 rounded border">
                      {estado.verifyRecord.type}
                    </code>
                    <span />
                    <span className="text-[var(--text-muted)]">Valor:</span>
                    <code className="font-mono text-xs bg-[var(--card)] px-2 py-1 rounded border break-all">
                      {estado.verifyRecord.value}
                    </code>
                    <Button variant="ghost" size="sm" onClick={() => copiar(estado.verifyRecord!.value)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] italic">
                    El cambio puede tardar hasta 24h en propagar.
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={verificar} disabled={busy}>
                  Verificar ahora
                </Button>
                <Button variant="ghost" onClick={eliminar} disabled={busy} className="text-[var(--danger-text)]">
                  <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                </Button>
              </div>
            </>
          )}

          {estado?.domain && estado.verified && (
            <>
              <div className="flex items-center gap-2 text-[var(--success-text)] text-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  <strong>{estado.domain}</strong> verificado. Tus empleados
                  ya pueden acceder por este dominio.
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Nota: el SSL se configura por separado en el proveedor de DNS
                (Cloudflare proxy o similar). En Fase 8 lo automatizamos.
              </p>
              <Button variant="ghost" onClick={eliminar} disabled={busy} className="text-[var(--danger-text)]">
                <Trash2 className="h-4 w-4 mr-1" /> Eliminar dominio
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
