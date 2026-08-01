"use client";

import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Articulo { id: string; titulo: string; contenido: string; categoria: string; autor: { nombre: string; apellidos: string }; createdAt: string; }
const CATEGORIAS = ["todas", "general", "novedades", "recursos", "formacion", "empresa"];

export default function EmpleadoArticulosPage() {
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState("todas");
  const [selected, setSelected] = useState<Articulo | null>(null);

  useEffect(() => {
    fetch("/api/articulos").then((r) => r.json()).then((d) => { setArticulos(d.articulos || []); setLoading(false); });
  }, []);

  const filtrados = cat === "todas" ? articulos : articulos.filter((a) => a.categoria === cat);

  if (selected) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <button onClick={() => setSelected(null)} className="text-sm text-[var(--primary)] hover:underline">← Volver a artículos</button>
        <span className="text-xs bg-[var(--primary-light)] text-[var(--primary)] px-2 py-0.5 rounded-full capitalize">{selected.categoria}</span>
        <h1 className="text-2xl font-bold text-[var(--text-dark)]">{selected.titulo}</h1>
        <p className="text-xs text-[var(--text-muted)]">{selected.autor.nombre} {selected.autor.apellidos} · {format(new Date(selected.createdAt), "d 'de' MMMM yyyy", { locale: es })}</p>
        <div className="prose prose-sm max-w-none text-[var(--text-body)] leading-relaxed whitespace-pre-wrap">{selected.contenido}</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div><h1 className="text-2xl font-bold text-[var(--text-dark)]">Artículos</h1><p className="text-[var(--text-muted)] text-sm mt-1">Base de conocimiento y recursos</p></div>
      <div className="flex gap-2 flex-wrap">
        {CATEGORIAS.map((c) => (
          <button key={c} onClick={() => setCat(c)} className={cn("px-3 py-1.5 rounded-full text-sm font-medium border transition-all capitalize", cat === c ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-[var(--card)] text-[var(--text-body)] border-[var(--border)] hover:border-[var(--primary)]")}>{c}</button>
        ))}
      </div>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[1, 2, 3, 4].map((i) => <div key={i} className="h-40 bg-[var(--muted)] rounded-xl animate-pulse" />)}</div>
      ) : filtrados.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><BookOpen className="h-10 w-10 text-slate-200 mx-auto mb-3" /><p className="text-[var(--text-muted)]">No hay artículos</p></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtrados.map((a) => (
            <Card key={a.id} className="hover:shadow-md transition-all cursor-pointer" onClick={() => setSelected(a)}>
              <CardContent className="pt-4 pb-4">
                <span className="text-xs bg-[var(--primary-light)] text-[var(--primary)] px-2 py-0.5 rounded-full capitalize">{a.categoria}</span>
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
