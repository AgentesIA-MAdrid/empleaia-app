/**
 * Geocodificación de direcciones de sedes vía Nominatim (OpenStreetMap).
 *
 * Gratis y sin API key, pero con límite de ~1 req/s y User-Agent
 * obligatorio (política de uso de Nominatim). Se invoca de forma puntual
 * (al crear/editar una sede), nunca en bucle masivo desde la app.
 *
 * `buildGeocodeQuery` es pura (testeable). `geocodeAddress` hace el fetch.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

function userAgent(): string {
  return (
    process.env.GEOCODER_USER_AGENT ||
    "empleaIA/1.0 (https://empleaia.es; soporte@empleaia.es)"
  );
}

/** Construye la query "dirección, CP, ciudad, España" omitiendo vacíos. */
export function buildGeocodeQuery(
  direccion?: string | null,
  ciudad?: string | null,
  codigoPostal?: string | null,
): string {
  return [direccion, codigoPostal, ciudad, "España"]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export interface GeocodeResult {
  latitud: number;
  longitud: number;
}

/**
 * Devuelve lat/long de la dirección, o null si no hay resultado o falla
 * el servicio. Nunca lanza: geocodificar es best-effort y no debe
 * bloquear el alta/edición de la sede.
 */
export async function geocodeAddress(
  direccion?: string | null,
  ciudad?: string | null,
  codigoPostal?: string | null,
): Promise<GeocodeResult | null> {
  const q = buildGeocodeQuery(direccion, ciudad, codigoPostal);
  // Sin nada útil que buscar (solo quedaría "España").
  if (!q || q === "España") return null;

  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    q,
    format: "json",
    limit: "1",
    countrycodes: "es",
  })}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent() },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const first = Array.isArray(data) ? data[0] : undefined;
    if (first?.lat && first?.lon) {
      const latitud = parseFloat(first.lat);
      const longitud = parseFloat(first.lon);
      if (!Number.isNaN(latitud) && !Number.isNaN(longitud)) {
        return { latitud, longitud };
      }
    }
  } catch {
    // timeout / red / parse — best-effort.
  }
  return null;
}
