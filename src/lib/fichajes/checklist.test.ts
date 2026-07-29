/**
 * Checklist de fichaje — lógica pura (ticket c4bc33d6).
 */

import { describe, it, expect } from "vitest";
import {
  admiteChecklist,
  normalizarItems,
  resolverChecklist,
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

describe("resolverChecklist", () => {
  it("con todos los puntos marcados devuelve las confirmaciones", () => {
    const r = resolverChecklist(items, [
      { itemId: "a", marcado: true },
      { itemId: "b", marcado: true },
    ]);
    expect(r.sinMarcar).toHaveLength(0);
    expect(r.confirmaciones).toHaveLength(2);
    expect(r.confirmaciones[0]).toMatchObject({ itemId: "a", texto: "Stock del turno anterior", orden: 0, marcado: true });
  });

  it("un punto sin marcar NO impide fichar: se guarda como no confirmado", () => {
    // Regla del producto (RD 8/2019, igual que el geofencing estricto del
    // #61): la jornada se registra siempre; lo que no se marcó queda visible.
    const r = resolverChecklist(items, [{ itemId: "a", marcado: true }]);
    expect(r.sinMarcar.map((i) => i.id)).toEqual(["b"]);
    expect(r.confirmaciones).toHaveLength(2);
    expect(r.confirmaciones.find((c) => c.itemId === "b")?.marcado).toBe(false);
  });

  it("un punto enviado con marcado=false cuenta como no confirmado", () => {
    const r = resolverChecklist(items, [
      { itemId: "a", marcado: true },
      { itemId: "b", marcado: false },
    ]);
    expect(r.sinMarcar.map((i) => i.id)).toEqual(["b"]);
    expect(r.confirmaciones.find((c) => c.itemId === "b")?.marcado).toBe(false);
  });

  it("sin respuestas se registran todos como no confirmados", () => {
    const r = resolverChecklist(items, undefined);
    expect(r.sinMarcar).toHaveLength(2);
    expect(r.confirmaciones.every((c) => c.marcado === false)).toBe(true);
  });

  it("sin puntos activos no hay nada que guardar", () => {
    const r = resolverChecklist([], undefined);
    expect(r.confirmaciones).toHaveLength(0);
    expect(r.sinMarcar).toHaveLength(0);
  });
});
