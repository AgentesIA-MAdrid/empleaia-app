"use client";

import { useEffect, useState, useCallback } from "react";
import { Megaphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Comunicado {
  id: string;
  titulo: string;
  contenido: string;
  publicadoEn?: string;
  autor: { nombre: string; apellidos: string };
  createdAt: string;
}

export default function ManagerComunicadosPage() {
  const [comunicados, setComunicados] = useState<Comunicado[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/comunicados");
      const data = await res.json();
      setComunicados(data.comunicados || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-dark)]">Comunicados</h1>
        <p className="text-[var(--text-muted)] text-sm mt-1">Mensajes internos de la empresa</p>
      </div>
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 bg-[var(--muted)] rounded-xl animate-pulse" />)}</div>
      ) : comunicados.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><Megaphone className="h-10 w-10 text-slate-200 mx-auto mb-3" /><p className="text-[var(--text-muted)]">No hay comunicados publicados</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {comunicados.map((c) => (
            <Card key={c.id}>
              <CardContent className="pt-4 pb-4">
                <h3 className="font-semibold text-[var(--text-dark)] mb-1">{c.titulo}</h3>
                <p className="text-sm text-[var(--text-body)]">{c.contenido}</p>
                <p className="text-xs text-[var(--text-muted)] mt-2">{c.autor.nombre} {c.autor.apellidos} · {format(new Date(c.createdAt), "d MMM yyyy", { locale: es })}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
