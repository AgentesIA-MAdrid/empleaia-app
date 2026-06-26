import { describe, it, expect, beforeEach } from "vitest";

// Secreto determinista para firmar/verificar en tests.
process.env.EMPLEAIA_SIGNING_SECRET = "test-signing-secret-action-token";

import { signFeedbackActionToken, verifyFeedbackActionToken } from "../action-token";

const TICKET = "bbbbbbbb-0000-0000-0000-000000000002";
const NOW = 1_750_000_000_000; // epoch ms fijo

describe("feedback action-token", () => {
  beforeEach(() => {
    process.env.EMPLEAIA_SIGNING_SECRET = "test-signing-secret-action-token";
  });

  it("firma y verifica un token válido", () => {
    const token = signFeedbackActionToken({ ticket_id: TICKET, action: "resolve" }, NOW);
    const payload = verifyFeedbackActionToken(token, NOW + 1000);
    expect(payload).not.toBeNull();
    expect(payload!.ticket_id).toBe(TICKET);
    expect(payload!.action).toBe("resolve");
    expect(payload!.jti.length).toBeGreaterThan(0);
  });

  it("cada token lleva un jti distinto (single-use)", () => {
    const a = verifyFeedbackActionToken(signFeedbackActionToken({ ticket_id: TICKET, action: "resolve" }, NOW), NOW + 1)!;
    const b = verifyFeedbackActionToken(signFeedbackActionToken({ ticket_id: TICKET, action: "resolve" }, NOW), NOW + 1)!;
    expect(a.jti).not.toBe(b.jti);
  });

  it("rechaza un token caducado (TTL 7 días)", () => {
    const token = signFeedbackActionToken({ ticket_id: TICKET, action: "resolve" }, NOW);
    const after = NOW + 7 * 24 * 60 * 60 * 1000 + 1;
    expect(verifyFeedbackActionToken(token, after)).toBeNull();
  });

  it("rechaza firma manipulada", () => {
    const token = signFeedbackActionToken({ ticket_id: TICKET, action: "resolve" }, NOW);
    const [b64] = token.split(".");
    expect(verifyFeedbackActionToken(`${b64}.deadbeefdeadbeef`, NOW + 1)).toBeNull();
  });

  it("rechaza payload manipulado (otro ticket, firma vieja)", () => {
    const token = signFeedbackActionToken({ ticket_id: TICKET, action: "resolve" }, NOW);
    const [, sig] = token.split(".");
    const evil = Buffer.from(
      JSON.stringify({ ticket_id: "cccccccc-0000-0000-0000-000000000003", action: "resolve", jti: "x", exp: NOW + 99999 }),
    ).toString("base64url");
    expect(verifyFeedbackActionToken(`${evil}.${sig}`, NOW + 1)).toBeNull();
  });

  it("rechaza basura / formato inválido", () => {
    expect(verifyFeedbackActionToken("", NOW)).toBeNull();
    expect(verifyFeedbackActionToken("sin-punto", NOW)).toBeNull();
    expect(verifyFeedbackActionToken("a.b.c", NOW)).toBeNull();
  });

  it("un token firmado con otro secreto no verifica", () => {
    const token = signFeedbackActionToken({ ticket_id: TICKET, action: "resolve" }, NOW);
    process.env.EMPLEAIA_SIGNING_SECRET = "otro-secreto-distinto";
    expect(verifyFeedbackActionToken(token, NOW + 1)).toBeNull();
  });
});
