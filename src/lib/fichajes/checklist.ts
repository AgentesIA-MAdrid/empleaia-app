/**
 * Checklist de fichaje — lógica pura compartida por:
 *  - POST /api/fichajes (valida las confirmaciones antes de registrar).
 *  - GET/PUT /api/checklist-fichaje (catálogo editable por el OWNER).
 *
 * Ticket c4bc33d6: antes de fichar la entrada el empleado confirma que
 * ha revisado el stock y el fondo de caja del turno anterior y el estado
 * de la tienda; antes de la salida, que ha registrado ventas y stock y
 * hecho el cierre de caja.
 *
 * Sin acceso a Prisma: recibe los datos ya leídos. Así se testea sin BD
 * (misma pauta que `src/lib/informes/queries.ts`).
 */

import { TipoFichaje } from "@/generated/prisma-tenant/client";

/** Tipos de fichaje que admiten checklist. Pausa/vuelta no lo piden. */
export const TIPOS_CON_CHECKLIST = [
  TipoFichaje.ENTRADA,
  TipoFichaje.SALIDA,
] as const;

export type TipoConChecklist = (typeof TIPOS_CON_CHECKLIST)[number];

export type ChecklistItem = {
  id: string;
  tipo: TipoFichaje;
  texto: string;
  orden: number;
  activo: boolean;
};

/** Lo que envía el cliente al fichar: qué items ha marcado. */
export type RespuestaChecklist = { itemId: string; marcado: boolean };

/** Fila lista para persistir en `FichajeChecklist`. */
export type ConfirmacionChecklist = {
  itemId: string;
  texto: string;
  orden: number;
  marcado: boolean;
};

export function admiteChecklist(tipo: TipoFichaje): tipo is TipoConChecklist {
  return (TIPOS_CON_CHECKLIST as readonly TipoFichaje[]).includes(tipo);
}

/** Longitud máxima del enunciado de un punto de control. */
export const CHECKLIST_TEXTO_MAX = 200;
/** Tope de items por tipo — evita listas inmanejables en el móvil. */
export const CHECKLIST_MAX_ITEMS = 20;

/**
 * Comprueba que el empleado ha marcado TODOS los puntos activos del
 * tipo de fichaje. Devuelve las confirmaciones a guardar, o los items
 * que faltan por marcar.
 *
 * Nota RD 8/2019: esto no impide registrar la jornada — el empleado
 * solo tiene que confirmar los puntos, no depende de terceros ni de
 * conectividad extra. Aun así el checklist es opt-in por tenant
 * (`ConfiguracionEmpresa.checklistFichajeActivo`).
 */
export function validarChecklist(
  itemsActivos: ChecklistItem[],
  respuestas: RespuestaChecklist[] | undefined,
): { ok: true; confirmaciones: ConfirmacionChecklist[] } | { ok: false; faltan: ChecklistItem[] } {
  const marcados = new Set(
    (respuestas ?? []).filter((r) => r?.marcado === true).map((r) => r.itemId),
  );
  const faltan = itemsActivos.filter((i) => !marcados.has(i.id));
  if (faltan.length > 0) return { ok: false, faltan };
  return {
    ok: true,
    confirmaciones: itemsActivos.map((i) => ({
      itemId: i.id,
      texto: i.texto,
      orden: i.orden,
      marcado: true,
    })),
  };
}

export type ItemEntrada = {
  id?: string | null;
  tipo: unknown;
  texto: unknown;
  orden?: unknown;
  activo?: unknown;
};

export type ItemNormalizado = {
  id: string | null;
  tipo: TipoConChecklist;
  texto: string;
  orden: number;
  activo: boolean;
};

/**
 * Valida y normaliza la lista completa de items que envía el OWNER
 * desde /admin/configuracion (PUT reemplaza el catálogo entero).
 */
export function normalizarItems(
  entrada: unknown,
): { ok: true; items: ItemNormalizado[] } | { ok: false; error: string } {
  if (!Array.isArray(entrada)) {
    return { ok: false, error: "items debe ser un array" };
  }
  const items: ItemNormalizado[] = [];
  for (const raw of entrada as ItemEntrada[]) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "item inválido" };
    }
    const tipo = raw.tipo;
    if (typeof tipo !== "string" || !admiteChecklist(tipo as TipoFichaje)) {
      return { ok: false, error: "tipo debe ser ENTRADA o SALIDA" };
    }
    const texto = typeof raw.texto === "string" ? raw.texto.trim() : "";
    if (texto.length < 3) {
      return { ok: false, error: "el texto de cada punto necesita 3 caracteres mínimo" };
    }
    if (texto.length > CHECKLIST_TEXTO_MAX) {
      return { ok: false, error: `el texto no puede pasar de ${CHECKLIST_TEXTO_MAX} caracteres` };
    }
    const ordenRaw = raw.orden;
    const orden =
      typeof ordenRaw === "number" && Number.isInteger(ordenRaw) && ordenRaw >= 0
        ? ordenRaw
        : items.filter((i) => i.tipo === tipo).length;
    items.push({
      id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : null,
      tipo: tipo as TipoConChecklist,
      texto,
      orden,
      activo: raw.activo !== false,
    });
  }
  for (const tipo of TIPOS_CON_CHECKLIST) {
    if (items.filter((i) => i.tipo === tipo).length > CHECKLIST_MAX_ITEMS) {
      return { ok: false, error: `máximo ${CHECKLIST_MAX_ITEMS} puntos por tipo de fichaje` };
    }
  }
  return { ok: true, items };
}

/** Texto de error para el empleado cuando quedan puntos sin marcar. */
export function mensajeFaltanChecks(tipo: TipoFichaje): string {
  return tipo === TipoFichaje.SALIDA
    ? "Confirma todos los puntos de control antes de fichar la salida."
    : "Confirma todos los puntos de control antes de fichar la entrada.";
}
