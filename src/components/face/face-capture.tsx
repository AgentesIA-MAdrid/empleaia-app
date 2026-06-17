"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Camera, AlertCircle } from "lucide-react";

/**
 * Captura facial usando face-api.js cargado desde CDN.
 *
 * Carga la librería + modelos al montar (~5MB), pide acceso a cámara,
 * detecta cara en cada frame y calcula un descriptor 128-D L2-normalizado.
 * Exige un parpadeo (liveness anti-foto) y que el descriptor sea estable
 * durante varios frames seguidos; entonces llama a `onCapture(embedding)`
 * con el array de 128 floats.
 *
 * El embedding NUNCA se sube como foto — solo el vector numérico
 * (irreversible) se manda al servidor para enroll/verify.
 */

const FACE_API_URL = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const MODELS_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model";
// Capturas estables consecutivas necesarias para confirmar el embedding.
const STABLE_FRAMES = 3;

// Liveness anti-foto: exigimos un parpadeo antes de confirmar. Eye Aspect
// Ratio (EAR) alto = ojo abierto, bajo = cerrado. Una foto estática no
// cruza estos umbrales, así que no supera el challenge.
const EAR_OPEN = 0.28;
const EAR_CLOSED = 0.21;

type Pt = { x: number; y: number };

/** EAR de un ojo a partir de sus 6 landmarks (face-api.js getLeftEye/getRightEye). */
function eyeAspectRatio(eye: Pt[]): number {
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const vertical = dist(eye[1]!, eye[5]!) + dist(eye[2]!, eye[4]!);
  const horizontal = 2 * dist(eye[0]!, eye[3]!);
  return horizontal === 0 ? 0 : vertical / horizontal;
}

declare global {
  interface Window {
    faceapi?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
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

export function FaceCapture({ onCapture, cta, pending, captureSnapshot }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "capturing" | "captured" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("Cargando modelo facial…");
  const stableRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // 1. Cargar face-api.js si no está.
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

        // 2. Cargar modelos (tinyFaceDetector + faceLandmark + faceRecognition).
        setHint("Cargando modelos (~5 MB)…");
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
        ]);
        if (cancelled) return;

        // 3. Pedir cámara.
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
        setHint("Centra tu rostro en la cámara y mantente quieto");
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
    setHint("Mira a la cámara y mantente quieto");
    stableRef.current = 0;
    let lastDescriptor: Float32Array | null = null;
    // Máquina de estados del parpadeo: vimos ojos abiertos → cerrados →
    // abiertos de nuevo = parpadeo válido.
    let sawOpen = false;
    let sawClosed = false;
    let blinked = false;

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

        // Liveness: no confirmamos hasta detectar un parpadeo.
        if (!blinked) {
          const ear =
            (eyeAspectRatio(detection.landmarks.getLeftEye()) +
              eyeAspectRatio(detection.landmarks.getRightEye())) /
            2;
          if (ear > EAR_OPEN) {
            if (sawClosed) blinked = true; // reabrió tras cerrar → parpadeo
            sawOpen = true;
          } else if (ear < EAR_CLOSED && sawOpen) {
            sawClosed = true;
          }
          if (!blinked) {
            setHint(sawClosed ? "Abre los ojos…" : "Parpadea una vez para confirmar que eres tú");
            return;
          }
        }

        const desc = detection.descriptor as Float32Array;
        if (lastDescriptor) {
          // Cosine similarity entre frames consecutivos para verificar estabilidad.
          let dot = 0, nA = 0, nB = 0;
          for (let i = 0; i < desc.length; i++) {
            dot += desc[i] * lastDescriptor[i];
            nA += desc[i] * desc[i];
            nB += lastDescriptor[i] * lastDescriptor[i];
          }
          const sim = dot / (Math.sqrt(nA) * Math.sqrt(nB));
          if (sim > 0.95) {
            stableRef.current += 1;
          } else {
            stableRef.current = 0;
          }
        }
        lastDescriptor = desc;
        if (stableRef.current >= STABLE_FRAMES) {
          clearInterval(interval);
          setPhase("captured");
          setHint("¡Listo! Rostro capturado.");

          // Extrae snapshot opcional ANTES de parar la cámara.
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
              // No bloqueante — si no hay snapshot, seguimos sin él.
            }
          }

          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
          }
          onCapture(Array.from(desc), snapshot);
          return;
        }
        setHint(`Sigue así… (${stableRef.current + 1}/${STABLE_FRAMES})`);
      } catch (err) {
        console.error("[face-capture]", err);
      }
    }, 250);
  }

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
          Capturar rostro
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
