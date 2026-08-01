"use client";

import { useEffect, useState, useCallback } from "react";
import { BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Articulo { id: string; titulo: string; contenido: string; categoria: string; vistas: number; autor: { nombre: string; apellidos: string }; createdAt: string; }

const CATEGORIAS = ["todas", "general", "novedades", "recursos", "formacion", "empresa"];

export default function ManagerArticulosPage() {
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoriaFiltro, setCategoriaFiltro] = useState("todas");

  useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/articulos");
    const data = await res.json();
    setArticulos(data.articulos || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch("/api/articulos").then((r) => r.json()).then((d) => { setArticulos(d.articulos || []); setLoading(false); });
  }, []);

  const articulosFiltrados = categoriaFiltro === "todas" ? articulos : articulos.filter((a) => a.categoria === categoriaFiltro);

  return (
    <div className="p-6 space-y-6">
      <div><h1 className="text-2xl font-bold text-[var(--text-dark)]">Artículos</h1><p className="text-[var(--text-muted)] text-sm mt-1">Base de conocimiento y recursos</p></div>
      <div className="flex gap-2 flex-wrap">
        {CATEGORIAS.map((cat) => (
          <button key={cat} onClick={() => setCategoriaFiltro(cat)} className={cn("px-3 py-1.5 rounded-full text-sm font-medium border transition-all capitalize", categoriaFiltro === cat ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-[var(--card)] text-[var(--text-body)] border-[var(--border)] hover:border-[var(--primary)]")}>{cat}</button>
        ))}
      </div>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[1, 2, 3, 4].map((i) => <div key={i} className="h-40 bg-[var(--muted)] rounded-xl animate-pulse" />)}</div>
      ) : articulosFiltrados.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><BookOpen className="h-10 w-10 text-slate-200 mx-auto mb-3" /><p className="text-[var(--text-muted)]">No hay artículos</p></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {articulosFiltrados.map((a) => (
            <Card key={a.id} className="hover:shadow-md transition-all">
              <CardContent className="pt-4 pb-4">
                <span className="text-xs bg-[var(--primary-light)] text-[var(--primary)] px-2 py-0.5 rounded-full font-medium capitalize">{a.categoria}</span>
                <h3 className="font-semibold text-[var(--text-dark)] mt-2">{a.titulo}</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1 line-clamp-3">{a.contenido}</p>
                <p className="text-xs text-[var(--text-muted)] mt-2">{a.autor.nombre} {a.autor.apellidos} · {format(new Date(a.createdAt), "d MMM yyyy", { locale: es })}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
