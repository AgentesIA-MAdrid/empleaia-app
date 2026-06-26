import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Token HMAC-firmado para la acción "Resolver con Claude" desde el email de
// ticket nuevo. Permite encolar un job SIN entrar al panel admin: el token ES
// la autorización (lo emitió nuestro server al mandar el email al super-admin).
// Defensa en profundidad: TTL corto + single-use (ledger feedback_action_tokens,
// consumido en el POST) + scope acotado al ticket.
//
// Formato: <base64url(payload)>.<hmac-sha256(payload)base64url>
// Clave: EMPLEAIA_SIGNING_SECRET (la misma del service-auth interno).

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días: el email puede tardar en abrirse.

export interface FeedbackActionPayload {
  ticket_id: string;
  action: "resolve";
  jti: string;
  exp: number;
}

function getSecret(): string {
  const k = process.env.EMPLEAIA_SIGNING_SECRET;
  if (!k) throw new Error("EMPLEAIA_SIGNING_SECRET no configurada");
  return k;
}

function sign(b64: string): string {
  return createHmac("sha256", getSecret()).update(b64).digest("base64url");
}

/** Firma un token de acción para un ticket. `ts` opcional para tests. */
export function signFeedbackActionToken(
  data: { ticket_id: string; action: "resolve" },
  ts?: number,
): string {
  const payload: FeedbackActionPayload = {
    ...data,
    jti: randomBytes(16).toString("base64url"),
    exp: (ts ?? Date.now()) + TOKEN_TTL_MS,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${b64}.${sign(b64)}`;
}

/** Verifica firma + caducidad + shape. Devuelve el payload o null. NO comprueba
 *  single-use: eso lo hace el ledger al consumir. `now` opcional para tests. */
export function verifyFeedbackActionToken(
  token: string,
  now?: number,
): FeedbackActionPayload | null {
  if (!token || typeof token !== "string") return null;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;

  const expected = sign(b64);
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  let payload: FeedbackActionPayload;
  try {
    payload = JSON.parse(Buffer.from(b64, "base64url").toString());
  } catch {
    return null;
  }
  if (payload.action !== "resolve") return null;
  if (typeof payload.ticket_id !== "string" || !payload.ticket_id) return null;
  if (typeof payload.jti !== "string" || !payload.jti) return null;
  if (typeof payload.exp !== "number" || payload.exp < (now ?? Date.now())) return null;

  return payload;
}
