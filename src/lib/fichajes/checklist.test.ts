/**
 * Checklist de fichaje — lógica pura (ticket c4bc33d6).
 */

import { describe, it, expect } from "vitest";
import {
  admiteChecklist,
  normalizarItems,
  validarChecklist,
  CHECKLIST_MAX_ITEMS,
  type ChecklistItem,
} from "./checklist";
import { TipoFichaje } from "@/generated/prisma-tenant/client";

const items: ChecklistItem[] = [
  { id: "a", tipo: TipoFichaje.ENTRADA, texto: "Stock del turno anterior", orden: 0, activo: true },
  { id: "b", tipo: TipoFichaje.ENTRADA, texto: "Fondo de caja", orden: 1, activo: true },
];

describe("admiteChecklist", () => {
  it("solo ENTRADA y SALIDA piden checklist", () => {
    expect(admiteChecklist(TipoFichaje.ENTRADA)).toBe(true);
    expect(admiteChecklist(TipoFichaje.SALIDA)).toBe(true);
    expect(admiteChecklist(TipoFichaje.PAUSA)).toBe(false);
    expect(admiteChecklist(TipoFichaje.VUELTA_PAUSA)).toBe(false);
  });
});

describe("validarChecklist", () => {
  it("con todos los puntos marcados devuelve las confirmaciones", () => {
    const r = validarChecklist(items, [
      { itemId: "a", marcado: true },
      { itemId: "b", marcado: true },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confirmaciones).toHaveLength(2);
    expect(r.confirmaciones[0]).toMatchObject({ itemId: "a", texto: "Stock del turno anterior", orden: 0 });
  });

  it("falta un punto → ok=false con los pendientes", () => {
    const r = validarChecklist(items, [{ itemId: "a", marcado: true }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltan.map((i) => i.id)).toEqual(["b"]);
  });

  it("un punto enviado con marcado=false cuenta como pendiente", () => {
    const r = validarChecklist(items, [
      { itemId: "a", marcado: true },
      { itemId: "b", marcado: false },
    ]);
    expect(r.ok).toBe(false);
  });

  it("sin respuestas → todos pendientes", () => {
    const r = validarChecklist(items, undefined);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltan).toHaveLength(2);
  });

  it("sin puntos activos no exige nada", () => {
    const r = validarChecklist([], undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confirmaciones).toEqual([]);
  });

  it("marcar puntos que ya no existen no cuela un fichaje incompleto", () => {
    const r = validarChecklist(items, [
      { itemId: "zzz", marcado: true },
      { itemId: "a", marcado: true },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltan.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("normalizarItems", () => {
  it("acepta una lista válida y recorta el texto", () => {
    const r = normalizarItems([
      { id: "a", tipo: "ENTRADA", texto: "  Revisar stock  ", orden: 0 },
      { tipo: "SALIDA", texto: "Cierre de caja" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items[0]).toMatchObject({ id: "a", texto: "Revisar stock", activo: true });
    // Sin id → alta nueva; sin orden → posición dentro de su tipo.
    expect(r.items[1]).toMatchObject({ id: null, tipo: "SALIDA", orden: 0 });
  });

  it("rechaza tipos que no son ENTRADA/SALIDA", () => {
    const r = normalizarItems([{ tipo: "PAUSA", texto: "Algo" }]);
    expect(r.ok).toBe(false);
  });

  it("rechaza textos vacíos o demasiado cortos", () => {
    expect(normalizarItems([{ tipo: "ENTRADA", texto: "  " }]).ok).toBe(false);
    expect(normalizarItems([{ tipo: "ENTRADA", texto: "ab" }]).ok).toBe(false);
  });

  it("rechaza textos demasiado largos", () => {
    const r = normalizarItems([{ tipo: "ENTRADA", texto: "x".repeat(201) }]);
    expect(r.ok).toBe(false);
  });

  it("rechaza más de CHECKLIST_MAX_ITEMS por tipo", () => {
    const muchos = Array.from({ length: CHECKLIST_MAX_ITEMS + 1 }, (_, i) => ({
      tipo: "ENTRADA",
      texto: `Punto ${i}`,
    }));
    expect(normalizarItems(muchos).ok).toBe(false);
  });

  it("rechaza payloads que no son array", () => {
    expect(normalizarItems({ tipo: "ENTRADA" }).ok).toBe(false);
  });
});
