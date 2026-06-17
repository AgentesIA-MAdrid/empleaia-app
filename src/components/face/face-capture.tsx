"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Camera, AlertCircle, ChevronLeft, ChevronRight, Check } from "lucide-react";

/**
 * Captura facial usando face-api.js cargado desde CDN.
 *
 * Carga la librería + modelos al montar (~5MB), pide acceso a cámara,
 * detecta cara en cada frame y calcula un descriptor 128-D L2-normalizado.
 *
 * Liveness anti-foto (estilo Face ID): pide girar la cabeza a un lado y al
 * otro (la pose de cabeza cambia → una foto estática no puede). Una vez
 * cubierto el movimiento, captura el descriptor con la cara de frente y
 * estable, y llama a `onCapture(embedding)` con el array de 128 floats.
 *
 * El embedding NUNCA se sube como foto — solo el vector numérico
 * (irreversible) se manda al servidor para enroll/verify.
 */

const FACE_API_URL = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const MODELS_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model";
// Capturas estables consecutivas (de frente) necesarias para confirmar.
const STABLE_FRAMES = 3;
// Umbrales de giro (yaw) sobre el ratio horizontal de la nariz dentro del
// óvalo facial: 0.5 = de frente, <0.40 / >0.60 = girado a cada lado.
const YAW_SIDE = 0.6; // un lado
const YAW_OPPOSITE = 0.4; // el otro
const YAW_CENTER = 0.1; // |ratio-0.5| por debajo de esto = mirando al frente

declare global {
  interface Window {
    faceapi?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

type Pt = { x: number; y: number };

/**
 * Ratio horizontal de la punta de la nariz dentro del contorno de la cara.
 * ~0.5 de frente; baja al girar a un lado y sube al girar al otro. Sirve
 * como estimador simple de yaw (giro horizontal de la cabeza).
 */
function headYawRatio(landmarks: { getJawOutline: () => Pt[]; getNose: () => Pt[] }): number {
  const jaw = landmarks.getJawOutline(); // 17 puntos (0=borde, 16=borde opuesto)
  const nose = landmarks.getNose(); // 9 puntos (27..35); la punta es el central
  const tip = nose[3] ?? nose[Math.floor(nose.length / 2)]!;
  const left = jaw[0]!;
  const right = jaw[16]!;
  const span = right.x - left.x;
  if (!span) return 0.5;
  return (tip.x - left.x) / span;
}

interface Props {
  onCapture: (embedding: number[], snapshot?: string) => void;
  cta: string;
  pending?: boolean;
  /**
   * Si true, además del embedding extraemos un snapshot del frame en
   * el que se confirmó el rostro y lo entregamos como data URL JPEG
   * comprimido (~150x150, calidad 0.7). Útil para auditoría server-side.
   */
  captureSnapshot?: boolean;
}

export function FaceCapture({ onCapture, pending, captureSnapshot }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "capturing" | "captured" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("Cargando modelo facial…");
  // Progreso del challenge de movimiento (feedback visual).
  const [turns, setTurns] = useState<{ a: boolean; b: boolean }>({ a: false, b: false });
  const stableRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!window.faceapi) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = FACE_API_URL;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("No se pudo cargar face-api.js"));
            document.head.appendChild(script);
          });
        }
        const faceapi = window.faceapi;
        if (!faceapi) throw new Error("face-api no disponible tras carga");
        if (cancelled) return;

        setHint("Cargando modelos (~5 MB)…");
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
        ]);
        if (cancelled) return;

        setHint("Pidiendo acceso a cámara…");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 480, facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }

        setPhase("ready");
        setHint("Centra tu rostro dentro del círculo");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    }

    void load();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function startCapture() {
    setPhase("capturing");
    setHint("Gira despacio la cabeza a un lado y al otro");
    setTurns({ a: false, b: false });
    stableRef.current = 0;
    let lastDescriptor: Float32Array | null = null;
    // Challenge de movimiento: hay que alcanzar ambos extremos de giro.
    let sideA = false; // ratio > YAW_SIDE
    let sideB = false; // ratio < YAW_OPPOSITE

    const faceapi = window.faceapi;
    if (!faceapi || !videoRef.current) return;

    const interval = setInterval(async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        const detection = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (!detection) {
          stableRef.current = 0;
          setHint("No detecto un rostro. Acércate o mejora la luz.");
          return;
        }

        const ratio = headYawRatio(detection.landmarks);

        // Fase 1: challenge de movimiento (liveness). No capturamos hasta
        // que la cabeza haya girado a ambos lados.
        if (!(sideA && sideB)) {
          if (ratio > YAW_SIDE && !sideA) {
            sideA = true;
            setTurns((t) => ({ ...t, a: true }));
          }
          if (ratio < YAW_OPPOSITE && !sideB) {
            sideB = true;
            setTurns((t) => ({ ...t, b: true }));
          }
          if (sideA && sideB) {
            setHint("¡Bien! Ahora mira de frente y mantente quieto");
          } else if (!sideA && !sideB) {
            setHint("Gira despacio la cabeza a un lado y al otro");
          } else {
            setHint("Sigue… gira la cabeza hacia el otro lado");
          }
          return;
        }

        // Fase 2: ya hizo el movimiento. Capturamos con la cara de frente
        // y el descriptor estable (mejor calidad para el matching).
        if (Math.abs(ratio - 0.5) > YAW_CENTER) {
          setHint("Mira de frente a la cámara");
          stableRef.current = 0;
          lastDescriptor = detection.descriptor as Float32Array;
          return;
        }

        const desc = detection.descriptor as Float32Array;
        if (lastDescriptor) {
          let dot = 0, nA = 0, nB = 0;
          for (let i = 0; i < desc.length; i++) {
            dot += desc[i]! * lastDescriptor[i]!;
            nA += desc[i]! * desc[i]!;
            nB += lastDescriptor[i]! * lastDescriptor[i]!;
          }
          const sim = dot / (Math.sqrt(nA) * Math.sqrt(nB));
          if (sim > 0.95) stableRef.current += 1;
          else stableRef.current = 0;
        }
        lastDescriptor = desc;

        if (stableRef.current >= STABLE_FRAMES) {
          clearInterval(interval);
          setPhase("captured");
          setHint("¡Listo! Rostro verificado.");

          let snapshot: string | undefined;
          if (captureSnapshot && canvasRef.current && videoRef.current) {
            try {
              const c = canvasRef.current;
              c.width = 150;
              c.height = 150;
              const ctx = c.getContext("2d");
              if (ctx) {
                ctx.drawImage(videoRef.current, 0, 0, 150, 150);
                snapshot = c.toDataURL("image/jpeg", 0.7);
              }
            } catch {
              // No bloqueante.
            }
          }

          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
          }
          onCapture(Array.from(desc), snapshot);
          return;
        }
        setHint(`Casi… mantente de frente (${stableRef.current + 1}/${STABLE_FRAMES})`);
      } catch (err) {
        console.error("[face-capture]", err);
      }
    }, 200);
  }

  const showGuide = phase === "ready" || phase === "capturing";

  return (
    <div className="space-y-4">
      <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-square max-w-sm mx-auto">
        {phase === "loading" || phase === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center">
            {phase === "loading" ? (
              <div className="text-center text-white space-y-2">
                <Loader2 className="h-8 w-8 mx-auto animate-spin" />
                <p className="text-sm">{hint}</p>
              </div>
            ) : (
              <div className="text-center text-white space-y-2 px-4">
                <AlertCircle className="h-8 w-8 mx-auto text-red-400" />
                <p className="text-sm">{error}</p>
              </div>
            )}
          </div>
        ) : null}
        <video
          ref={videoRef}
          className={`w-full h-full object-cover ${phase === "loading" || phase === "error" ? "opacity-0" : ""}`}
          playsInline
          muted
        />

        {/* Guía circular estilo Face ID + indicadores de giro. */}
        {showGuide && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div
              className={`h-[78%] w-[78%] rounded-full border-4 transition-colors ${
                turns.a && turns.b ? "border-emerald-400" : "border-white/80 animate-pulse"
              }`}
            />
            <div className="absolute left-2 top-1/2 -translate-y-1/2">
              {turns.a ? (
                <Check className="h-6 w-6 text-emerald-400" />
              ) : (
                <ChevronLeft className={`h-7 w-7 text-white ${phase === "capturing" ? "animate-pulse" : "opacity-60"}`} />
              )}
            </div>
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              {turns.b ? (
                <Check className="h-6 w-6 text-emerald-400" />
              ) : (
                <ChevronRight className={`h-7 w-7 text-white ${phase === "capturing" ? "animate-pulse" : "opacity-60"}`} />
              )}
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>

      {phase !== "error" && phase !== "captured" && (
        <p className="text-center text-sm text-slate-600">{hint}</p>
      )}

      {phase === "ready" && (
        <button
          type="button"
          onClick={startCapture}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-dark,#4f46e5)] px-5 py-3 text-sm font-semibold text-white"
        >
          <Camera className="h-4 w-4" />
          Empezar
        </button>
      )}
      {phase === "capturing" && (
        <div className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-100 px-5 py-3 text-sm font-medium text-amber-900">
          <Loader2 className="h-4 w-4 animate-spin" />
          {hint}
        </div>
      )}
      {phase === "captured" && (
        <div className="w-full text-center text-sm text-emerald-700 font-medium">
          ✓ {hint} {pending ? "Procesando…" : ""}
        </div>
      )}
    </div>
  );
}
