import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, differenceInMinutes, differenceInSeconds } from "date-fns";
import { es } from "date-fns/locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatFecha(date: Date | string, pattern = "dd/MM/yyyy") {
  return format(new Date(date), pattern, { locale: es });
}

export function formatHora(date: Date | string) {
  return format(new Date(date), "HH:mm", { locale: es });
}

export function formatFechaHora(date: Date | string) {
  return format(new Date(date), "dd/MM/yyyy HH:mm", { locale: es });
}

export function calcularHorasTrabajadas(
  fichajes: Array<{ tipo: string; timestamp: Date | string }>
): number {
  const sorted = [...fichajes].sort(
    (a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  let totalMinutos = 0;
  let entrada: Date | null = null;
  let enPausa = false;
  let inicioPausa: Date | null = null;

  for (const f of sorted) {
    const ts = new Date(f.timestamp);
    if (f.tipo === "ENTRADA" || f.tipo === "VUELTA_PAUSA") {
      if (f.tipo === "ENTRADA") entrada = ts;
      else enPausa = false;
    } else if (f.tipo === "PAUSA") {
      inicioPausa = ts;
      enPausa = true;
    } else if (f.tipo === "SALIDA") {
      if (entrada && !enPausa) {
        totalMinutos += differenceInMinutes(ts, entrada);
        entrada = null;
      }
    }
  }

  if (entrada && !enPausa) {
    totalMinutos += differenceInMinutes(new Date(), entrada);
  }

  return Math.round(totalMinutos / 60 * 100) / 100;
}

export function formatDuracion(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function calcularDistancia(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function getDiaSemana(date: Date | string): string {
  return format(new Date(date), "EEEE", { locale: es });
}

export function getColorRol(rol: string) {
  switch (rol) {
    case "OWNER":
      return "bg-violet-100 text-violet-700";
    case "MANAGER":
      return "bg-sky-100 text-sky-700";
    default:
      return "bg-emerald-100 text-emerald-700";
  }
}

export function getLabelRol(rol: string) {
  switch (rol) {
    case "OWNER":
      return "Administrador";
    case "MANAGER":
      return "Coordinador";
    default:
      return "Empleado";
  }
}
