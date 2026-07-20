"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, Eraser } from "lucide-react";
import { validarDni } from "@/lib/firmas/dni";

const INPUT =
  "flex h-10 w-full rounded-lg border border-[var(--color-border,#E2E8F0)] bg-white px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20";

/**
 * Formulario de firma manuscrita: el empleado confirma que ha leído el
 * documento, teclea su nombre y DNI/NIE y dibuja un garabato en el canvas.
 * Al firmar, el garabato + nombre + DNI se estampan en el margen izquierdo de
 * cada hoja del documento.
 */
export function FirmarForm({
  solicitudId,
  nombrePorDefecto,
}: {
  solicitudId: string;
  nombrePorDefecto: string;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const [haDibujado, setHaDibujado] = useState(false);
  const [leido, setLeido] = useState(false);
  const [nombre, setNombre] = useState(nombrePorDefecto);
  const [dni, setDni] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function ctx() {
    return canvasRef.current?.getContext("2d") ?? null;
  }

  function posicion(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (e.currentTarget.width / rect.width),
      y: (e.clientY - rect.top) * (e.currentTarget.height / rect.height),
    };
  }

  function empezar(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const c = ctx();
    if (!c) return;
    dibujando.current = true;
    const { x, y } = posicion(e);
    c.beginPath();
    c.moveTo(x, y);
  }

  function mover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return;
    const c = ctx();
    if (!c) return;
    const { x, y } = posicion(e);
    c.lineWidth = 2.5;
    c.lineCap = "round";
    c.strokeStyle = "#0f172a";
    c.lineTo(x, y);
    c.stroke();
    setHaDibujado(true);
  }

  function terminar() {
    dibujando.current = false;
  }

  function borrar() {
    const c = ctx();
    const canvas = canvasRef.current;
    if (!c || !canvas) return;
    c.clearRect(0, 0, canvas.width, canvas.height);
    setHaDibujado(false);
  }

  async function firmar() {
    setError(null);
    if (!leido) return setError("Confirma que has leído el documento antes de firmar.");
    if (nombre.trim().length < 3) return setError("Escribe tu nombre completo.");
    if (!validarDni(dni)) return setError("El DNI/NIE no es válido.");
    if (!haDibujado) return setError("Dibuja tu firma en el recuadro.");
    const garabato = canvasRef.current?.toDataURL("image/png");
    if (!garabato) return setError("No se pudo capturar la firma.");

    if (!confirm("¿Firmar este documento? La firma queda registrada con tu identidad y no se puede deshacer.")) return;
    setPending(true);
    try {
      const r = await fetch(`/api/solicitudes-firma/${solicitudId}/firmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim(), dni, garabato }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al firmar");
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-2.5 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={leido}
          onChange={(e) => setLeido(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]"
        />
        <span>He leído el documento y estoy de acuerdo con su contenido.</span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Nombre y apellidos</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={INPUT}
            placeholder="Nombre completo"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">DNI / NIE</span>
          <input
            value={dni}
            onChange={(e) => setDni(e.target.value.toUpperCase())}
            className={INPUT}
            placeholder="12345678Z"
            maxLength={12}
            autoCapitalize="characters"
          />
        </label>
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Tu firma</span>
          <button
            type="button"
            onClick={borrar}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-[var(--primary)]"
          >
            <Eraser className="h-3.5 w-3.5" /> Borrar
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={480}
          height={180}
          onPointerDown={empezar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerLeave={terminar}
          className="w-full touch-none rounded-lg border border-dashed border-slate-300 bg-slate-50"
        />
        <span className="text-xs text-slate-400">Dibuja tu firma con el ratón o el dedo.</span>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <button
        type="button"
        disabled={pending}
        onClick={firmar}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        {pending ? "Firmando…" : "Firmar ahora"}
      </button>
    </div>
  );
}
