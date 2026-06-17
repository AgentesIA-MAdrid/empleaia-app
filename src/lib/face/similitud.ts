/**
 * Distancia euclidiana entre dos embeddings faciales (Float32Array de 128).
 *
 * Es la métrica NATIVA de face-api.js (FaceNet / Inception ResNet V1, que
 * produce vectores 128-D L2-normalizados). Misma persona ≈ 0.2–0.45,
 * personas distintas ≈ 0.55+. Match si `distancia <= FACE_MATCH_THRESHOLD`.
 *
 * IMPORTANTE: NO usar similitud coseno con estos embeddings. Apuntan en
 * direcciones muy parecidas en el espacio, así que el coseno entre dos
 * caras DISTINTAS suele dar 0.8–0.99 → con cualquier umbral razonable
 * deja pasar a cualquiera (incl. familiares). Verificado en producción:
 * una foto de otra persona daba coseno 0.82 y se aceptaba como match.
 */

// Umbral estricto para fichaje (más seguro que el 0.6 por defecto de
// face-api.js). Equivale a rechazar parecidos de familiares: una cara
// distinta a ~0.6 de distancia queda fuera.
export const FACE_MATCH_THRESHOLD = 0.5;

export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Embeddings de dimensiones distintas: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}
