import { NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Auth de rutas internas server-to-server (el runner del ticketing). Firma HMAC
 * con timestamp (anti-replay). Portado de TuFacturaIA; aquí solo soportamos el
 * formato v2 (sin el legacy `x-service-key`, que este repo no usa).
 *
 *   Header:  X-Service-Signature: t=<unix_segundos>,v1=<hmac_sha256_hex>
 *   Payload: `${t}.${method}.${pathWithSearch}.${sha256_hex(body)}`
 *   Clave:   EMPLEAIA_SIGNING_SECRET (mismo secreto en app y runner).
 *
 * Atar method+path al HMAC cierra el replay horizontal (una firma capturada no
 * sirve para otro recurso). Tolerancia ±5 min sobre el timestamp.
 */

const SIG_HEADER = "x-service-signature";
const DEFAULT_TOLERANCE_SECONDS = 300;

function unauthorized(reason: string): NextResponse {
  return NextResponse.json(
    { error: "Unauthorized", reason },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

function parseSignatureHeader(header: string): { t: number; v1: string[] } | null {
  const parts = header.split(",").reduce<Record<string, string[]>>((acc, kv) => {
    const idx = kv.indexOf("=");
    if (idx <= 0) return acc;
    const k = kv.slice(0, idx).trim();
    const v = kv.slice(idx + 1).trim();
    (acc[k] ??= []).push(v);
    return acc;
  }, {});
  const tStr = parts.t?.[0];
  const v1List = parts.v1 ?? [];
  if (!tStr || v1List.length === 0) return null;
  const t = Number(tStr);
  if (!Number.isFinite(t)) return null;
  return { t, v1: v1List };
}

function normalizePathWithSearch(reqUrl: string): string {
  try {
    const u = new URL(reqUrl);
    return `${u.pathname}${u.search}`;
  } catch {
    return "/";
  }
}

function computeExpected(args: {
  secret: string;
  t: number;
  bodyHash: string;
  method: string;
  pathWithSearch: string;
}): string {
  const payload = `${args.t}.${args.method}.${args.pathWithSearch}.${args.bodyHash}`;
  return createHmac("sha256", args.secret).update(payload, "utf8").digest("hex");
}

function matchesAnyHex(actual: string[], expected: string): boolean {
  for (const v of actual) {
    if (v.length !== expected.length) continue;
    try {
      if (timingSafeEqual(Buffer.from(v, "hex"), Buffer.from(expected, "hex"))) return true;
    } catch {
      /* hex inválido o longitudes distintas */
    }
  }
  return false;
}

/**
 * Verifica el request contra la firma HMAC. Devuelve `null` si autoriza, o un
 * `NextResponse 401` listo para devolver. El caller debe leer el body raw ANTES
 * (`await req.text()`) y pasarlo aquí (leerlo aquí consumiría el stream).
 */
export function requireServiceAuth(req: Request, body: string): NextResponse | null {
  const sigHeader = req.headers.get(SIG_HEADER);
  const secret = process.env.EMPLEAIA_SIGNING_SECRET;
  if (!sigHeader) return unauthorized("no_header");
  if (!secret) {
    console.error("[internal/auth] EMPLEAIA_SIGNING_SECRET no configurada — rechazo firma");
    return unauthorized("misconfigured");
  }
  const parsed = parseSignatureHeader(sigHeader);
  if (!parsed) return unauthorized("malformed");

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.t) > DEFAULT_TOLERANCE_SECONDS) {
    return unauthorized("expired_timestamp");
  }

  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const expected = computeExpected({
    secret,
    t: parsed.t,
    bodyHash,
    method: req.method.toUpperCase(),
    pathWithSearch: normalizePathWithSearch(req.url),
  });
  return matchesAnyHex(parsed.v1, expected) ? null : unauthorized("bad_signature");
}

/**
 * Construye el valor del header `X-Service-Signature` para callers
 * server-to-server (el runner firma sus requests con esto). `ts` opcional
 * para tests deterministas.
 */
export function buildSignatureHeader(args: {
  method: string;
  pathWithSearch: string;
  body: string;
  secret: string;
  ts?: number;
}): string {
  const t = args.ts ?? Math.floor(Date.now() / 1000);
  const bodyHash = createHash("sha256").update(args.body, "utf8").digest("hex");
  const v1 = computeExpected({
    secret: args.secret,
    t,
    bodyHash,
    method: args.method.toUpperCase(),
    pathWithSearch: args.pathWithSearch,
  });
  return `t=${t},v1=${v1}`;
}
