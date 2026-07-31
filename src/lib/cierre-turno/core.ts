/**
 * Cierre de turno — lógica pura del módulo (plan Enterprise).
 *
 * Sin Prisma ni red: los handlers leen los datos y llaman a estas funciones,
 * igual que `src/lib/informes/queries.ts`. Así se testea sin base de datos.
 *
 * Regla que atraviesa el módulo: nada de aquí puede impedir fichar. El
 * registro de jornada es obligación legal (RD 8/2019) y no depende de que el
 * comercial haya cerrado su caja — lo que falte se reclama después.
 */

/** Pasos del asistente diario, en orden. */
export const PASOS_CIERRE = ["ventas", "resultados", "caja", "incidencias"] as const;
export type PasoCierre = (typeof PASOS_CIERRE)[number];

/** Estados de un cierre. "incompleto" no se guarda: se deduce del día. */
export type EstadoCierre = "borrador" | "completado" | "revisado";

/** Alcance de consulta según el rol de quien mira. */
export type AlcanceCierre = "propio" | "sede" | "todos";

/**
 * Qué puede ver cada rol:
 *  - EMPLEADO: solo sus cierres.
 *  - MANAGER (coordinador): los de las sedes que coordina, para poder apretar.
 *  - OWNER: todos.
 *
 * "sede" es en plural desde el ticket 73: un coordinador lleva varios puntos
 * de venta, no uno. Sus sedes son las que tenga asignadas (`UsuarioSede`, más
 * la principal de su ficha) — ver `sedesDelUsuario`.
 */
export function alcanceSegunRol(rol: string): AlcanceCierre {
  if (rol === "OWNER") return "todos";
  if (rol === "MANAGER") return "sede";
  return "propio";
}

/**
 * Por qué sede filtrar una consulta del módulo.
 *
 * El caso que esto cierra: alguien con alcance de sede (coordinador, comercial)
 * pero **sin sede asignada**. Si el filtro se construye con
 * `...(tiendaId ? { tiendaId } : {})`, ese `null` hace desaparecer el filtro y
 * la persona termina viendo la caja de todas las tiendas. Aquí ese caso es
 * `"ninguna"`: no hay nada que enseñarle, que es distinto de "enséñale todo".
 */
export type FiltroSede =
  | { tipo: "todas" }
  | { tipo: "sedes"; tiendaIds: string[] }
  | { tipo: "ninguna" };

/**
 * `sedesPropias` son todas las sedes de esa persona (ticket 73: un coordinador
 * lleva varias). Puede pedir una concreta por querystring, pero solo si es
 * suya: una sede ajena no amplía su alcance, se ignora y sigue viendo las
 * suyas. Administración sí elige cualquiera.
 */
export function filtroSede(
  rol: string,
  sedesPropias: string[],
  sedePedida?: string | null,
): FiltroSede {
  if (alcanceSegunRol(rol) === "todos") {
    return sedePedida ? { tipo: "sedes", tiendaIds: [sedePedida] } : { tipo: "todas" };
  }
  const propias = [...new Set(sedesPropias.filter(Boolean))];
  if (propias.length === 0) return { tipo: "ninguna" };
  if (sedePedida && propias.includes(sedePedida)) {
    return { tipo: "sedes", tiendaIds: [sedePedida] };
  }
  return { tipo: "sedes", tiendaIds: propias };
}

/**
 * El filtro como cláusula `where` de Prisma, para no repetir el ternario en
 * cada handler. `"ninguna"` no tiene traducción a where —no hay que consultar,
 * hay que responder vacío— y por eso no se acepta aquí.
 */
export function whereSede(
  filtro: Extract<FiltroSede, { tipo: "todas" | "sedes" }>,
): { tiendaId?: { in: string[] } } {
  return filtro.tipo === "todas" ? {} : { tiendaId: { in: filtro.tiendaIds } };
}

/** Áreas que solo ven coordinadores y administradores. */
export function puedeVerObjetivos(rol: string): boolean {
  return rol === "OWNER" || rol === "MANAGER";
}

/** La conciliación es solo de administración. */
export function puedeVerConciliacion(rol: string): boolean {
  return rol === "OWNER";
}

/** Fijar objetivos es de administración; el coordinador solo consulta. */
export function puedeFijarObjetivos(rol: string): boolean {
  return rol === "OWNER";
}

/**
 * Un cierre de caja confirmado no lo toca su autor: solo un administrador, y
 * dejando rastro (CierreCajaEdicion). Antes de confirmar, el comercial puede
 * corregir su propio borrador.
 */
export function puedeEditarCaja(rol: string, confirmado: boolean, esPropio: boolean): boolean {
  if (rol === "OWNER") return true;
  return !confirmado && esPropio;
}

/**
 * Día del cierre en zona Europe/Madrid, como "YYYY-MM-DD". Se usa la hora
 * peninsular y no la del servidor: un cierre hecho a las 00:30 de Madrid
 * pertenece a ese día, y con UTC caería en el anterior.
 */
export function diaMadrid(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Mes "YYYY-MM" de una fecha, en horario local. */
export function mesDe(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Porcentaje de consecución, redondeado a un decimal. Sin objetivo devuelve
 * null: mostrar "0 %" cuando nadie ha fijado objetivo es engañoso, y un 100 %
 * por dividir entre cero, peor.
 */
export function consecucion(vendido: number, objetivo: number): number | null {
  if (!Number.isFinite(objetivo) || objetivo <= 0) return null;
  return Math.round((vendido / objetivo) * 1000) / 10;
}

/**
 * Diferencia entre lo que la tienda declara en el arqueo y lo que suman los
 * cierres diarios de esa semana. Positiva = sobra efectivo; negativa = falta.
 */
export function diferenciaArqueo(declarado: number, segunCierres: number): number {
  return Math.round((declarado - segunCierres) * 100) / 100;
}

/**
 * ¿Contamos esta diferencia como descuadre? Por debajo del umbral es ruido
 * de redondeo y llenar la pantalla de avisos de céntimos la vuelve inútil.
 */
export const UMBRAL_DESCUADRE_EUR = 1;

export function esDescuadre(diferencia: number, umbral = UMBRAL_DESCUADRE_EUR): boolean {
  return Math.abs(diferencia) >= umbral;
}

/**
 * Qué pasos le faltan a un cierre. Lo usa la vigilancia diaria para decir en
 * qué se quedó cada persona, en vez de un "incompleto" sin más.
 */
export function pasosPendientes(cierre: {
  ventas: number;
  detalleJornada?: string | null;
  cajaConfirmada: boolean;
  completadoEn?: Date | null;
}): PasoCierre[] {
  const faltan: PasoCierre[] = [];
  if (cierre.ventas === 0 && !cierre.detalleJornada) faltan.push("ventas");
  if (!cierre.cajaConfirmada) faltan.push("caja");
  if (!cierre.completadoEn) faltan.push("incidencias");
  return faltan;
}

/** Un cierre está completo cuando no le falta ningún paso. */
export function estaCompleto(cierre: Parameters<typeof pasosPendientes>[0]): boolean {
  return pasosPendientes(cierre).length === 0;
}

// ─── Validación del guardado (entrega 2) ──────────────────────────────────────
//
// Un cierre de caja es por comercial: cada uno declara lo que ha cobrado él.
// Decidido con el cliente el 2026-07-30, y es lo que hace atribuible un
// descuadre a una persona concreta.

/** Tope por fichero adjunto. Un Excel de stock y unas fotos del TPV caben de sobra. */
export const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;

/** Lo que se acepta como Excel de stock o comprobante del datáfono. */
export const MIMES_ADJUNTO = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type TipoAdjunto = "stock" | "tpv";

export function adjuntoAceptado(mime: string, bytes: number): { ok: true } | { ok: false; error: string } {
  if (!(MIMES_ADJUNTO as readonly string[]).includes(mime)) {
    return { ok: false, error: "Formato no admitido: sube un Excel, un CSV, un PDF o una foto." };
  }
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (bytes > MAX_ADJUNTO_BYTES) {
    return { ok: false, error: "El archivo pasa de 10 MB. Comprímelo o súbelo por partes." };
  }
  return { ok: true };
}

export interface VentaEntrada {
  articuloId?: unknown;
  cantidad?: unknown;
}

export interface VentaNormalizada {
  articuloId: string;
  cantidad: number;
}

/**
 * Normaliza las cantidades vendidas contra el catálogo activo.
 *
 * Descarta lo que no exista en el catálogo (un artículo desactivado a media
 * jornada, o un id inventado) y las cantidades no válidas. Devuelve solo las
 * filas con cantidad > 0: guardar ceros llenaría la tabla de ruido sin
 * cambiar ningún total.
 */
export function normalizarVentas(
  articulosActivos: { id: string; nombre: string }[],
  entrada: VentaEntrada[] | undefined,
): { ventas: VentaNormalizada[]; descartadas: number } {
  const validos = new Map(articulosActivos.map((a) => [a.id, a.nombre]));
  const vistos = new Set<string>();
  const ventas: VentaNormalizada[] = [];
  let descartadas = 0;

  for (const fila of entrada ?? []) {
    const id = typeof fila?.articuloId === "string" ? fila.articuloId : null;
    const cantidad =
      typeof fila?.cantidad === "number"
        ? fila.cantidad
        : typeof fila?.cantidad === "string"
          ? Number.parseInt(fila.cantidad, 10)
          : Number.NaN;

    if (!id || !validos.has(id) || vistos.has(id)) {
      descartadas += 1;
      continue;
    }
    if (!Number.isInteger(cantidad) || cantidad < 0) {
      descartadas += 1;
      continue;
    }
    vistos.add(id);
    if (cantidad > 0) ventas.push({ articuloId: id, cantidad });
  }

  return { ventas, descartadas };
}

/**
 * Importe de caja: euros con dos decimales, nunca negativo. Acepta coma o
 * punto porque en el móvil se escribe con coma.
 */
export function normalizarImporte(valor: unknown): { ok: true; importe: number } | { ok: false; error: string } {
  const bruto =
    typeof valor === "number"
      ? valor
      : typeof valor === "string"
        ? Number.parseFloat(valor.replace(",", "."))
        : Number.NaN;

  if (!Number.isFinite(bruto)) return { ok: false, error: "Escribe un importe válido." };
  if (bruto < 0) return { ok: false, error: "El importe no puede ser negativo." };
  if (bruto > 1_000_000) return { ok: false, error: "Ese importe no parece correcto." };
  return { ok: true, importe: Math.round(bruto * 100) / 100 };
}

/**
 * Paso 4: si dice que hubo incidencia, hay que describirla. Un "sí" sin texto
 * no sirve para nada a quien recibe el aviso.
 */
export function normalizarIncidencia(
  hayIncidencia: unknown,
  texto: unknown,
): { ok: true; incidencia: string | null } | { ok: false; error: string } {
  if (hayIncidencia !== true) return { ok: true, incidencia: null };
  const t = typeof texto === "string" ? texto.trim() : "";
  if (t.length < 5) {
    return { ok: false, error: "Cuenta qué ha pasado (mínimo 5 caracteres)." };
  }
  return { ok: true, incidencia: t.slice(0, 4000) };
}

/**
 * Motivo obligatorio cuando un administrador corrige una caja ya confirmada:
 * es lo que hace útil el registro de la corrección.
 */
export function normalizarMotivoEdicion(valor: unknown): { ok: true; motivo: string } | { ok: false; error: string } {
  const t = typeof valor === "string" ? valor.trim() : "";
  if (t.length < 5) return { ok: false, error: "Indica por qué corriges el cierre (mínimo 5 caracteres)." };
  return { ok: true, motivo: t.slice(0, 1000) };
}
