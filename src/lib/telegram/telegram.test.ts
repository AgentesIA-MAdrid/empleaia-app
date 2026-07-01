import { describe, it, expect } from "vitest";
import { escapeHtml } from "./client";
import { ticketKeyboard } from "./notify";
import { parsePrUrl } from "./github";

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

  it("fase inicial: ofrece 'A Claudia' pero NO 'En desarrollo'", () => {
    const datas = ticketKeyboard(id, true, "inicial").flat().map((b) => b.callback_data);
    for (const a of ["resp", "ver", "claudia", "ok", "no"]) expect(datas).toContain(`t:${id}:${a}`);
    expect(datas).not.toContain(`t:${id}:dev`);
  });

  it("fase diagnostico: ofrece 'En desarrollo' en lugar de 'A Claudia'", () => {
    const datas = ticketKeyboard(id, true, "diagnostico").flat().map((b) => b.callback_data);
    expect(datas).toContain(`t:${id}:dev`);
    expect(datas).not.toContain(`t:${id}:claudia`);
    for (const a of ["resp", "ver", "ok", "no"]) expect(datas).toContain(`t:${id}:${a}`);
  });

  it("fase pr: ofrece revisar y mergear el PR", () => {
    const datas = ticketKeyboard(id, true, "pr").flat().map((b) => b.callback_data);
    expect(datas).toContain(`t:${id}:revpr`);
    expect(datas).toContain(`t:${id}:merge`);
    for (const a of ["resp", "ver", "dev", "no"]) expect(datas).toContain(`t:${id}:${a}`);
  });

  it("fase cerrado: solo el botón de ver aunque el destinatario pueda operar", () => {
    const kb = ticketKeyboard(id, true, "cerrado");
    expect(kb).toHaveLength(1);
    expect(kb[0]).toHaveLength(1);
    expect(kb[0][0].callback_data).toBe(`t:${id}:ver`);
  });

  it("callback_data cabe en el límite de 64 bytes de Telegram (todas las fases)", () => {
    for (const fase of ["inicial", "diagnostico", "pr", "cerrado"] as const) {
      for (const b of ticketKeyboard(id, true, fase).flat()) {
        expect(Buffer.byteLength(b.callback_data ?? "", "utf8")).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe("parsePrUrl", () => {
  it("extrae owner/repo/number de una URL de PR", () => {
    expect(parsePrUrl("https://github.com/AgentesIA-MAdrid/empleaia-app/pull/32")).toEqual({
      owner: "AgentesIA-MAdrid", repo: "empleaia-app", number: 32,
    });
  });
  it("devuelve null para URLs no válidas", () => {
    expect(parsePrUrl("https://github.com/foo/bar")).toBeNull();
    expect(parsePrUrl(null)).toBeNull();
  });
});
