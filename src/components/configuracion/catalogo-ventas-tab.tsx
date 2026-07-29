"use client";

/**
 * Configuración → Catálogo de ventas.
 *
 * Aquí el administrador sube su tabla de artículos y servicios (Excel o CSV) y
 * la retoca. Es la tabla que verá el comercial en el paso 1 del cierre de turno,
 * en este mismo orden.
 *
 * Los artículos no se borran: se desactivan. Las ventas ya registradas con uno
 * de ellos tienen que seguir siendo legibles.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, FileSpreadsheet, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface Articulo {
  id: string;
  nombre: string;
  categoria: string | null;
  orden: number;
  activo: boolean;
}

interface ResumenImportacion {
  creados: number;
  actualizados: number;
  desactivados: number;
  conCabecera: boolean;
  ignoradas: { fila: number; motivo: string }[];
  totalIgnoradas: number;
}

export function CatalogoVentasTab() {
  const { toast } = useToast();
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [resumen, setResumen] = useState<ResumenImportacion | null>(null);
  const inputFichero = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/articulos-venta?todos=1");
      if (!res.ok) return;
      const data = (await res.json()) as { articulos: Articulo[] };
      setArticulos(data.articulos ?? []);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const subir = async (fichero: File) => {
    setSubiendo(true);
    setResumen(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("No se ha podido leer el archivo"));
        fr.readAsDataURL(fichero);
      });

      const res = await fetch("/api/articulos-venta/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombreFichero: fichero.name, contenidoBase64: base64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se ha podido importar",
          description: data.error ?? "Revisa el archivo e inténtalo de nuevo.",
          variant: "destructive",
        });
        return;
      }
      setResumen(data as ResumenImportacion);
      toast({
        title: "Catálogo actualizado",
        description: `${data.creados} nuevos, ${data.actualizados} actualizados${
          data.desactivados ? `, ${data.desactivados} desactivados` : ""
        }.`,
      });
      await cargar();
    } catch (err) {
      toast({
        title: "Error al subir",
        description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setSubiendo(false);
      if (inputFichero.current) inputFichero.current.value = "";
    }
  };

  const cambiarActivo = async (a: Articulo) => {
    const res = await fetch("/api/articulos-venta", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, activo: !a.activo }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ title: "No se pudo cambiar", description: data.error ?? "", variant: "destructive" });
      return;
    }
    await cargar();
  };

  const activos = articulos.filter((a) => a.activo);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Catálogo de ventas</h2>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          La lista de artículos y servicios que tu equipo registra al cerrar el turno. Súbela
          desde Excel o CSV: basta una columna con el nombre, y si añades una segunda se usa
          como categoría para agrupar. El orden del archivo es el orden en el que la verán.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={inputFichero}
              type="file"
              accept=".xlsx,.xls,.csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void subir(f);
              }}
            />
            <Button disabled={subiendo} onClick={() => inputFichero.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              {subiendo ? "Importando…" : "Subir catálogo"}
            </Button>
            <span className="text-sm text-slate-500">
              {activos.length > 0
                ? `${activos.length} artículos activos`
                : "Todavía no hay catálogo: tu equipo no puede registrar ventas."}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Al importar, lo que vuelva a aparecer se actualiza y lo que ya no esté se desactiva
            —nunca se borra, para no romper el histórico de ventas.
          </p>
        </CardContent>
      </Card>

      {resumen && (
        <Card className="border-slate-200">
          <CardContent className="pt-4 pb-4 text-sm space-y-2">
            <p className="font-medium text-slate-800 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-slate-400" />
              Resultado de la importación
            </p>
            <p className="text-slate-600">
              {resumen.creados} nuevos · {resumen.actualizados} actualizados ·{" "}
              {resumen.desactivados} desactivados
              {resumen.conCabecera ? " · la primera fila se ha tomado como encabezado" : ""}
            </p>
            {resumen.totalIgnoradas > 0 && (
              <div>
                <p className="text-amber-700">
                  {resumen.totalIgnoradas} fila{resumen.totalIgnoradas === 1 ? "" : "s"} sin
                  importar:
                </p>
                <ul className="mt-1 space-y-0.5 text-slate-500">
                  {resumen.ignoradas.map((ig) => (
                    <li key={`${ig.fila}-${ig.motivo}`}>
                      Fila {ig.fila}: {ig.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {cargando ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : articulos.length === 0 ? (
            <p className="text-center py-10 text-slate-400 text-sm">
              Sube tu tabla para empezar.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["#", "Artículo o servicio", "Categoría", "Estado", ""].map((h) => (
                      <th
                        key={h}
                        className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {articulos.map((a, i) => (
                    <tr
                      key={a.id}
                      className={`border-b border-slate-100 last:border-0 ${a.activo ? "" : "opacity-50"}`}
                    >
                      <td className="px-4 py-2.5 text-sm text-slate-400 tabular-nums">{i + 1}</td>
                      <td className="px-4 py-2.5 text-sm font-medium text-slate-800">{a.nombre}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-500">{a.categoria ?? "—"}</td>
                      <td className="px-4 py-2.5 text-sm">
                        {a.activo ? (
                          <span className="text-emerald-700">Activo</span>
                        ) : (
                          <span className="text-slate-500">Desactivado</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button variant="ghost" size="sm" onClick={() => void cambiarActivo(a)}>
                          {a.activo ? (
                            <>
                              <EyeOff className="h-3.5 w-3.5 mr-1.5" /> Desactivar
                            </>
                          ) : (
                            <>
                              <Eye className="h-3.5 w-3.5 mr-1.5" /> Reactivar
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
