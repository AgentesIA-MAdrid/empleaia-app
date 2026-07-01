import { describe, it, expect } from "vitest";
import { escapeHtml } from "./client";
import { ticketKeyboard } from "./notify";

describe("escapeHtml (Telegram)", () => {
  it("escapa solo & < > (no comillas, que Telegram permite)", () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d "e"');
  });
  it("tolera null/undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("ticketKeyboard", () => {
  const id = "11111111-2222-3333-4444-555555555555";

  it("solo-recibe: únicamente el botón de ver", () => {
    const kb = ticketKeyboard(id, false);
    expect(kb).toHaveLength(1);
    expect(kb[0]).toHaveLength(1);
    expect(kb[0][0].callback_data).toBe(`t:${id}:ver`);
  });

  it("operador: incluye responder, claudia, dev, ok, no y ver", () => {
    const kb = ticketKeyboard(id, true);
    const datas = kb.flat().map((b) => b.callback_data);
    for (const a of ["resp", "ver", "claudia", "dev", "ok", "no"]) {
      expect(datas).toContain(`t:${id}:${a}`);
    }
  });

  it("soloVer: solo el botón de ver aunque el destinatario pueda operar", () => {
    const kb = ticketKeyboard(id, true, true);
    expect(kb).toHaveLength(1);
    expect(kb[0]).toHaveLength(1);
    expect(kb[0][0].callback_data).toBe(`t:${id}:ver`);
  });

  it("callback_data cabe en el límite de 64 bytes de Telegram", () => {
    const kb = ticketKeyboard(id, true);
    for (const b of kb.flat()) {
      expect(Buffer.byteLength(b.callback_data ?? "", "utf8")).toBeLessThanOrEqual(64);
    }
  });
});
