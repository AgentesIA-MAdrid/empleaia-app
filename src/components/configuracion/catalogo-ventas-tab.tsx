"use client";

/**
 * Configuración → Catálogo de ventas.
 *
 * Aquí el administrador define su tabla de artículos y servicios —a mano o
 * subiéndola en Excel o CSV— y la retoca. Es la tabla que verá el comercial en
 * el paso 1 del cierre de turno, en este mismo orden, y la lista sobre la que
 * se fijan los objetivos de venta por comercial y por sede.
 *
 * Añadir a mano existe porque el caso corriente son cuatro o cinco conceptos
 * (pospago, fibra, renove, prepago, energía): pedir un Excel para eso es pedir
 * que no se empiece. El importador sigue siendo el camino del catálogo largo.
 *
 * Los artículos no se borran: se desactivan. Las ventas ya registradas con uno
 * de ellos tienen que seguir siendo legibles.
 *
 * Los precios son opcionales y van tras un interruptor: hay clientes que solo
 * cuentan unidades vendidas. Encendido, el módulo puede leer las ventas en
 * euros y cruzarlas con lo que hay en caja.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, FileSpreadsheet, Eye, EyeOff, Euro, Plus, Users } from "lucide-react";
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
  precio: number | null;
}

interface ResumenImportacion {
  creados: number;
  actualizados: number;
  desactivados: number;
  conCabecera: boolean;
  conPrecios: boolean;
  ignoradas: { fila: number; motivo: string }[];
  totalIgnoradas: number;
}

export function CatalogoVentasTab() {
  const { toast } = useToast();
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [resumen, setResumen] = useState<ResumenImportacion | null>(null);
  const [preciosActivos, setPreciosActivos] = useState(false);
  const [guardandoPrecios, setGuardandoPrecios] = useState(false);
  const [enRodaje, setEnRodaje] = useState(true);
  const [guardandoRodaje, setGuardandoRodaje] = useState(false);
  const inputFichero = useRef<HTMLInputElement>(null);

  // Alta a mano.
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [nuevoPrecio, setNuevoPrecio] = useState("");
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/articulos-venta?todos=1");
      if (!res.ok) return;
      const data = (await res.json()) as {
        articulos: Articulo[];
        preciosActivos: boolean;
        enRodaje: boolean;
      };
      setArticulos(data.articulos ?? []);
      setPreciosActivos(Boolean(data.preciosActivos));
      setEnRodaje(data.enRodaje !== false);
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

  /**
   * Abre el módulo al equipo (o lo vuelve a guardar en rodaje). Es el único
   * ajuste de esta pantalla que cambia lo que ve toda la plantilla, así que
   * pide confirmación antes.
   */
  const cambiarRodaje = async (nuevoEnRodaje: boolean) => {
    if (!nuevoEnRodaje) {
      const activos = articulos.filter((a) => a.activo).length;
      const aviso =
        activos === 0
          ? "Todavía no has subido el catálogo de artículos: tu equipo verá el módulo, pero no podrá registrar ventas. ¿Abrirlo de todas formas?"
          : "A partir de ahora todo tu equipo verá Cierre de turno y Arqueos en su menú. ¿Seguimos?";
      if (!window.confirm(aviso)) return;
    }
    setGuardandoRodaje(true);
    try {
      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cierreTurnoEnRodaje: nuevoEnRodaje }),
      });
      if (!res.ok) {
        toast({ title: "No se pudo guardar", variant: "destructive" });
        return;
      }
      setEnRodaje(nuevoEnRodaje);
      toast({
        title: nuevoEnRodaje ? "Módulo en rodaje" : "Módulo abierto al equipo",
        description: nuevoEnRodaje
          ? "Solo lo ves tú y el resto de administradores."
          : "Cierre de turno y Arqueos ya aparecen en el menú de tu equipo. Recarga su app si la tienen abierta.",
      });
    } finally {
      setGuardandoRodaje(false);
    }
  };

  /** Añade un artículo escrito a mano y deja el formulario listo para el siguiente. */
  const crear = async () => {
    if (!nuevoNombre.trim()) {
      toast({ title: "Escribe el nombre del artículo", variant: "destructive" });
      return;
    }
    setCreando(true);
    try {
      const res = await fetch("/api/articulos-venta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nuevoNombre,
          categoria: nuevaCategoria,
          precio: nuevoPrecio.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se ha podido añadir",
          description: (data as { error?: string }).error ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: (data as { reactivado?: boolean }).reactivado ? "Artículo reactivado" : "Artículo añadido",
        description: (data as { reactivado?: boolean }).reactivado
          ? "Ya existía desactivado y vuelve a estar disponible con su histórico."
          : `"${(data as Articulo).nombre}" ya se puede registrar en el cierre de turno.`,
      });
      setNuevoNombre("");
      setNuevaCategoria("");
      setNuevoPrecio("");
      await cargar();
    } catch {
      toast({ title: "Sin conexión", description: "No se ha añadido el artículo.", variant: "destructive" });
    } finally {
      setCreando(false);
    }
  };

  /** Guarda el nombre o la categoría de un artículo ya existente. */
  const guardarCampo = async (a: Articulo, campo: "nombre" | "categoria", valor: string) => {
    const res = await fetch("/api/articulos-venta", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, [campo]: valor.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({
        title: "No se ha podido guardar",
        description: (data as { error?: string }).error ?? "",
        variant: "destructive",
      });
      // Volver a cargar deja la casilla con el valor que sí está guardado, en
      // vez de dejar en pantalla un cambio que el servidor ha rechazado.
      await cargar();
      return;
    }
    await cargar();
  };

  /** Enciende o apaga los precios del catálogo (guardado inmediato). */
  const cambiarPreciosActivos = async (valor: boolean) => {
    setGuardandoPrecios(true);
    try {
      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ventasPreciosActivos: valor }),
      });
      if (!res.ok) {
        toast({ title: "No se pudo guardar", variant: "destructive" });
        return;
      }
      setPreciosActivos(valor);
      toast({
        title: valor ? "Precios activados" : "Precios desactivados",
        description: valor
          ? "Ahora puedes poner un precio a cada artículo y ver las ventas en euros."
          : "El módulo vuelve a contar solo unidades. Los precios que hubieras puesto se conservan.",
      });
    } finally {
      setGuardandoPrecios(false);
    }
  };

  /** Guarda el precio de un artículo. Vacío = sin precio (no es cero euros). */
  const guardarPrecio = async (a: Articulo, valor: string) => {
    const limpio = valor.trim();
    const res = await fetch("/api/articulos-venta", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, precio: limpio === "" ? null : limpio }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "No se pudo guardar el precio", description: data.error ?? "", variant: "destructive" });
      await cargar();
      return;
    }
    setArticulos((prev) =>
      prev.map((x) => (x.id === a.id ? { ...x, precio: (data as Articulo).precio ?? null } : x)),
    );
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
          La lista de artículos y servicios que tu equipo registra al cerrar el turno, y sobre
          la que se fijan los objetivos de venta por comercial y por sede. Añádelos aquí uno a
          uno, o súbelos de golpe desde Excel o CSV si tienes muchos.
        </p>
      </div>

      {/* Quién ve el módulo. Va primero porque es la decisión que más se nota:
          el resto de esta pantalla solo afecta a cómo se registra la venta. */}
      <Card className={enRodaje ? "border-amber-200 bg-amber-50/40" : undefined}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium text-slate-900 flex items-center gap-2">
                {enRodaje ? (
                  <EyeOff className="h-4 w-4 text-amber-600" />
                ) : (
                  <Users className="h-4 w-4 text-[var(--primary)]" />
                )}
                {enRodaje ? "En rodaje: solo lo veis administración" : "Abierto a todo el equipo"}
              </p>
              <p className="text-xs text-slate-600 mt-1 max-w-xl">
                {enRodaje
                  ? "Prepáralo con calma —sube el catálogo, reparte los PIN de recogida, fija los objetivos del mes— y ábrelo cuando esté listo. Mientras, tu equipo no ve nada nuevo en su menú."
                  : "Tu equipo ve Cierre de turno y Arqueos en su menú. Puedes volver a guardarlo en rodaje si necesitas retocar algo."}
              </p>
            </div>
            <Button
              variant={enRodaje ? "default" : "outline"}
              size="sm"
              disabled={guardandoRodaje}
              onClick={() => void cambiarRodaje(!enRodaje)}
            >
              {guardandoRodaje
                ? "Guardando…"
                : enRodaje
                  ? "Abrir al equipo"
                  : "Volver a rodaje"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-slate-900 flex items-center gap-2">
              <Plus className="h-4 w-4 text-[var(--primary)]" /> Añadir un artículo
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              Escribe cada concepto que vendéis: pospago, fibra, renove, prepago, energía… La
              categoría es opcional y solo sirve para agruparlos en la tabla.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[12rem]">
              <label htmlFor="catalogo-nuevo-nombre" className="text-xs text-slate-500">
                Artículo o servicio
              </label>
              <Input
                id="catalogo-nuevo-nombre"
                className="mt-1"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void crear();
                }}
                placeholder="Pospago"
                maxLength={120}
              />
            </div>
            <div className="flex-1 min-w-[10rem]">
              <label htmlFor="catalogo-nueva-categoria" className="text-xs text-slate-500">
                Categoría (opcional)
              </label>
              <Input
                id="catalogo-nueva-categoria"
                className="mt-1"
                value={nuevaCategoria}
                onChange={(e) => setNuevaCategoria(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void crear();
                }}
                placeholder="Telefonía"
                maxLength={80}
              />
            </div>
            {preciosActivos && (
              <div className="w-32">
                <label htmlFor="catalogo-nuevo-precio" className="text-xs text-slate-500">
                  Precio
                </label>
                <Input
                  id="catalogo-nuevo-precio"
                  type="number"
                  step="0.01"
                  min="0"
                  className="mt-1 text-right tabular-nums"
                  value={nuevoPrecio}
                  onChange={(e) => setNuevoPrecio(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void crear();
                  }}
                  placeholder="—"
                />
              </div>
            )}
            <Button disabled={creando} onClick={() => void crear()}>
              <Plus className="h-4 w-4 mr-2" />
              {creando ? "Añadiendo…" : "Añadir"}
            </Button>
          </div>
        </CardContent>
      </Card>

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
            <Button variant="outline" disabled={subiendo} onClick={() => inputFichero.current?.click()}>
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
            Basta una columna con el nombre, y si añades una segunda se usa como categoría. Al
            importar, lo que vuelva a aparecer se actualiza y lo que ya no esté se desactiva
            —incluido lo que hayas añadido a mano y no figure en la hoja—, nunca se borra, para
            no romper el histórico de ventas. Si tu hoja tiene una columna llamada{" "}
            <strong>Precio</strong> (o PVP), se importa también.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-900 flex items-center gap-2">
                <Euro className="h-4 w-4 text-[var(--primary)]" /> Trabajar con precios
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-xl">
                Enciéndelo si además de unidades quieres ver el importe vendido y poder cruzarlo
                con el efectivo y la tarjeta de los cierres. Si tu equipo solo cuenta unidades,
                déjalo apagado y no se te pedirá ningún precio.
              </p>
            </div>
            <button
              type="button"
              disabled={guardandoPrecios}
              aria-pressed={preciosActivos}
              onClick={() => void cambiarPreciosActivos(!preciosActivos)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                preciosActivos ? "bg-[var(--primary)]" : "bg-slate-200"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  preciosActivos ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
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
            {resumen.conPrecios && !preciosActivos && (
              <p className="text-slate-600">
                La hoja traía precios y los hemos guardado, pero ahora mismo no se usan.
                <Button
                  variant="link"
                  className="h-auto p-0 ml-1 align-baseline"
                  disabled={guardandoPrecios}
                  onClick={() => void cambiarPreciosActivos(true)}
                >
                  Activar los precios
                </Button>
              </p>
            )}
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
              Añade tu primer artículo ahí arriba, o sube tu tabla para empezar.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["#", "Artículo o servicio", "Categoría", ...(preciosActivos ? ["Precio"] : []), "Estado", ""].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 py-3"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {articulos.map((a, i) => (
                    <tr
                      key={a.id}
                      className={`border-b border-slate-100 last:border-0 ${a.activo ? "" : "opacity-50"}`}
                    >
                      <td className="px-4 py-2.5 text-sm text-slate-400 tabular-nums">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        {/* Igual que el precio: se guarda al salir del campo.
                            La `key` lleva el valor guardado para que, si el
                            servidor lo rechaza o lo normaliza, la casilla se
                            repinte con lo que hay en la base de datos. */}
                        <Input
                          key={`nombre-${a.id}-${a.nombre}`}
                          className="min-w-[10rem] font-medium"
                          defaultValue={a.nombre}
                          maxLength={120}
                          aria-label={`Nombre de ${a.nombre}`}
                          onBlur={(e) => {
                            const nuevo = e.target.value.trim();
                            if (nuevo !== a.nombre) void guardarCampo(a, "nombre", nuevo);
                          }}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <Input
                          key={`categoria-${a.id}-${a.categoria ?? ""}`}
                          className="min-w-[8rem]"
                          defaultValue={a.categoria ?? ""}
                          placeholder="—"
                          maxLength={80}
                          aria-label={`Categoría de ${a.nombre}`}
                          onBlur={(e) => {
                            const nuevo = e.target.value.trim();
                            if (nuevo !== (a.categoria ?? "")) void guardarCampo(a, "categoria", nuevo);
                          }}
                        />
                      </td>
                      {preciosActivos && (
                        <td className="px-4 py-2.5">
                          {/* Se guarda al salir del campo: rellenar precios es
                              teclear en cadena, y un botón por fila sobra. */}
                          <Input
                            key={`precio-${a.id}-${a.precio ?? ""}`}
                            type="number"
                            step="0.01"
                            min="0"
                            className="w-28 text-right tabular-nums"
                            defaultValue={a.precio ?? ""}
                            placeholder="—"
                            aria-label={`Precio de ${a.nombre}`}
                            onBlur={(e) => {
                              const nuevo = e.target.value.trim();
                              const actual = a.precio === null ? "" : String(a.precio);
                              if (nuevo !== actual) void guardarPrecio(a, nuevo);
                            }}
                          />
                        </td>
                      )}
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
