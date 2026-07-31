"use client";

/**
 * Configuración → Catálogo de ventas.
 *
 * Aquí el administrador define su tabla de artículos y servicios —a mano o
 * subiéndola en Excel o CSV— y la retoca. Es la tabla que verá el comercial en
 * el paso 1 del cierre de turno, en este mismo orden, y la lista sobre la que
 * se fijan los objetivos de venta por comercial y por sede. Ese orden se
 * recoloca con las flechas de cada fila: dando de alta a mano, todo cae al
 * final, y lo que se vende a diario tiene que quedar arriba.
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
import {
  Upload,
  FileSpreadsheet,
  Eye,
  EyeOff,
  Euro,
  Plus,
  Users,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { moverEnOrden } from "@/lib/cierre-turno/catalogo";

interface Articulo {
  id: string;
  nombre: string;
  categoria: string | null;
  orden: number;
  activo: boolean;
  precio: number | null;
  /** Sus unidades empujan los objetivos de venta (totales y los de su grupo). */
  cuentaParaObjetivos: boolean;
}

/** Persona con acceso anticipado al módulo mientras está en rodaje. */
interface PersonaPiloto {
  id: string;
  nombre: string;
  rol: string;
  sede: string | null;
  acceso: boolean;
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
  const [personas, setPersonas] = useState<PersonaPiloto[]>([]);
  const [pilotoElegido, setPilotoElegido] = useState("");
  const [guardandoPiloto, setGuardandoPiloto] = useState<string | null>(null);
  const [guardandoOrden, setGuardandoOrden] = useState(false);
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

  /** Quién puede estrenar el módulo y quién ya lo tiene. */
  const cargarPersonas = useCallback(async () => {
    try {
      const res = await fetch("/api/cierre-turno/pilotos");
      if (!res.ok) return;
      const data = (await res.json()) as { personas: PersonaPiloto[] };
      setPersonas(data.personas ?? []);
    } catch {
      /* sin conexión: la lista se queda como esté */
    }
  }, []);

  useEffect(() => {
    void cargar();
    void cargarPersonas();
  }, [cargar, cargarPersonas]);

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

  /** Da o quita el acceso anticipado a una persona durante el rodaje. */
  const cambiarPiloto = async (userId: string, acceso: boolean) => {
    if (!userId) return;
    setGuardandoPiloto(userId);
    try {
      const res = await fetch("/api/cierre-turno/pilotos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, acceso }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "No se pudo guardar",
          description: (data as { error?: string }).error ?? "",
          variant: "destructive",
        });
        return;
      }
      const r = data as { nombre: string; avisoSinSede?: boolean };
      toast({
        title: acceso ? `${r.nombre} ya puede usarlo` : `${r.nombre} deja de verlo`,
        description: acceso
          ? r.avisoSinSede
            ? "Ojo: no tiene sede asignada, así que su cierre no entrará en los cuadres y no podrá declarar arqueos. Asígnale una en Empleados."
            : "Verá Cierre de turno y Arqueos en su menú al recargar la app."
          : undefined,
        variant: acceso && r.avisoSinSede ? "destructive" : undefined,
      });
      setPilotoElegido("");
      await cargarPersonas();
    } finally {
      setGuardandoPiloto(null);
    }
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

  /**
   * Decide si el artículo cuenta para los objetivos de venta. Apagado, se sigue
   * vendiendo y registrando en el cierre igual: lo único que cambia es que sus
   * unidades no empujan el objetivo de unidades totales ni el de su categoría.
   */
  const cambiarCuentaObjetivos = async (a: Articulo) => {
    const valor = !a.cuentaParaObjetivos;
    const res = await fetch("/api/articulos-venta", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, cuentaParaObjetivos: valor }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ title: "No se pudo cambiar", description: data.error ?? "", variant: "destructive" });
      await cargar();
      return;
    }
    setArticulos((prev) =>
      prev.map((x) => (x.id === a.id ? { ...x, cuentaParaObjetivos: valor } : x)),
    );
    toast({
      title: valor ? `"${a.nombre}" cuenta para los objetivos` : `"${a.nombre}" ya no cuenta`,
      description: valor
        ? "Sus unidades vuelven a sumar en el objetivo de unidades totales y en el de su categoría."
        : "Se sigue vendiendo y registrando igual, pero sus unidades no suman en ningún objetivo.",
    });
  };

  /**
   * Sube o baja un artículo una posición. La tabla se recoloca en pantalla al
   * instante y se manda el orden completo al servidor: colocar el catálogo son
   * varios clics seguidos y esperar al servidor entre uno y otro se nota.
   * Si el guardado falla, la lista vuelve a como estaba.
   */
  const mover = async (a: Articulo, direccion: -1 | 1) => {
    const nuevosIds = moverEnOrden(
      articulos.map((x) => x.id),
      a.id,
      direccion,
    );
    if (!nuevosIds) return;

    const previos = articulos;
    const porId = new Map(articulos.map((x) => [x.id, x]));
    setArticulos(nuevosIds.map((id) => porId.get(id)).filter((x): x is Articulo => Boolean(x)));
    setGuardandoOrden(true);
    try {
      const res = await fetch("/api/articulos-venta/orden", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: nuevosIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setArticulos(previos);
        toast({
          title: "No se ha podido guardar el orden",
          description: (data as { error?: string }).error ?? "Inténtalo de nuevo.",
          variant: "destructive",
        });
        // 409 = alguien tocó el catálogo desde otra pestaña: se recarga para
        // ordenar sobre la lista que hay de verdad.
        if (res.status === 409) await cargar();
      }
    } catch {
      setArticulos(previos);
      toast({ title: "Sin conexión", description: "El orden no se ha guardado.", variant: "destructive" });
    } finally {
      setGuardandoOrden(false);
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
  const pilotos = personas.filter((p) => p.acceso);
  const candidatos = personas.filter((p) => !p.acceso);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Catálogo de ventas</h2>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          La lista de artículos y servicios que tu equipo registra al cerrar el turno, y sobre
          la que se fijan los objetivos de venta por comercial y por sede. Añádelos aquí uno a
          uno, o súbelos de golpe desde Excel o CSV si tienes muchos. Con las flechas de cada
          fila los colocas en el orden que quieras: es el mismo que verá tu equipo, y con el
          interruptor{" "}
          <strong className="font-medium text-slate-600">Cuenta para objetivos</strong> eliges qué
          artículos empujan los objetivos y cuáles no.
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

          {/* Estrenarlo con una persona concreta. Solo tiene sentido mientras
              esté en rodaje: abierto, ya lo ve todo el mundo. */}
          {enRodaje && (
            <div className="mt-4 pt-4 border-t border-amber-200/70">
              <p className="text-sm font-medium text-slate-800">Estrenarlo con alguien del equipo</p>
              <p className="text-xs text-slate-600 mt-1 max-w-xl">
                Dale acceso a quien vaya a probarlo en su tienda. Solo verá Cierre de turno y
                Arqueos: no toca nada de administración.
              </p>

              {pilotos.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {pilotos.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        <span className="font-medium text-slate-800">{p.nombre}</span>
                        <span className="text-slate-500">
                          {" "}
                          · {p.sede ?? "sin sede asignada"}
                        </span>
                        {!p.sede && (
                          <span className="text-amber-700 text-xs block">
                            Sin sede, su cierre no entra en los cuadres y no podrá declarar
                            arqueos. Asígnale una en Empleados.
                          </span>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={guardandoPiloto === p.id}
                        onClick={() => void cambiarPiloto(p.id, false)}
                      >
                        Quitar acceso
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3 flex items-end gap-2 flex-wrap">
                <div>
                  <Label htmlFor="piloto-nuevo" className="text-xs">
                    Añadir a alguien
                  </Label>
                  <select
                    id="piloto-nuevo"
                    className="mt-1 w-64 rounded-md border border-slate-200 px-3 py-2 text-sm"
                    value={pilotoElegido}
                    onChange={(e) => setPilotoElegido(e.target.value)}
                  >
                    <option value="">Elige una persona…</option>
                    {candidatos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                        {p.sede ? ` · ${p.sede}` : " · sin sede"}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pilotoElegido || guardandoPiloto !== null}
                  onClick={() => void cambiarPiloto(pilotoElegido, true)}
                >
                  Dar acceso
                </Button>
              </div>
            </div>
          )}
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
              categoría es opcional: agrupa los artículos en la tabla del cierre y es el grupo
              sobre el que puedes fijar un objetivo (Telefonía, Servicios…).
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
            <strong>Precio</strong> (o PVP), se importa también. Ten en cuenta que al importar
            la lista queda en el orden de la hoja, así que si ya la habías colocado a mano
            tendrás que repasarla.
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
                    {[
                      "#",
                      "Artículo o servicio",
                      "Categoría",
                      ...(preciosActivos ? ["Precio"] : []),
                      "Cuenta para objetivos",
                      "Estado",
                      "",
                    ].map(
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
                      {/* Interruptor por artículo: hay conceptos que se venden
                          pero no se persiguen, y sumarlos infla la consecución
                          de quien tiene el objetivo puesto sobre otra cosa. */}
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          aria-pressed={a.cuentaParaObjetivos}
                          aria-label={`${a.nombre} cuenta para los objetivos`}
                          title={
                            a.cuentaParaObjetivos
                              ? "Sus unidades suman en el objetivo de unidades totales y en el de su categoría."
                              : "Se sigue vendiendo, pero sus unidades no suman en ningún objetivo."
                          }
                          onClick={() => void cambiarCuentaObjetivos(a)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            a.cuentaParaObjetivos ? "bg-[var(--primary)]" : "bg-slate-200"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              a.cuentaParaObjetivos ? "translate-x-5" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-sm">
                        {a.activo ? (
                          <span className="text-emerald-700">Activo</span>
                        ) : (
                          <span className="text-slate-500">Desactivado</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {/* Las flechas colocan el catálogo después de haberlo
                            dado de alta: el orden de esta tabla es el que ve el
                            comercial al cerrar el turno. */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={guardandoOrden || i === 0}
                          aria-label={`Subir ${a.nombre}`}
                          title="Subir"
                          onClick={() => void mover(a, -1)}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={guardandoOrden || i === articulos.length - 1}
                          aria-label={`Bajar ${a.nombre}`}
                          title="Bajar"
                          onClick={() => void mover(a, 1)}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
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
