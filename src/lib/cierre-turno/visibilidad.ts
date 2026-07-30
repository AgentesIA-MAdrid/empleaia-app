/**
 * Quién ve el módulo de cierre de turno en el menú.
 *
 * Dos condiciones distintas, y conviene no mezclarlas:
 *
 *  - **Bloqueada**: el plan del cliente no incluye `cierre_turno`. No se pinta
 *    nada (los items del módulo van con `ocultarSiBloqueado`), porque un candado
 *    invita a preguntar por algo que aún no se le vende.
 *  - **En rodaje**: el cliente SÍ lo tiene contratado, pero todavía no lo ha
 *    abierto a su equipo. Administración lo ve para prepararlo —subir el
 *    catálogo, repartir los PIN de recogida, fijar los objetivos del mes— y el
 *    resto no, para que no le aparezca en el menú una sección a medio montar.
 *
 * Durante el rodaje se puede dar **acceso anticipado** a personas concretas
 * (`User.cierreTurnoPiloto`): estrenar el módulo con quien se presta a probarlo
 * en su tienda, sin abrírselo a la plantilla y sin hacerla administradora —eso
 * le daría acceso a nóminas y al resto de la administración—.
 *
 * Es solo del menú: las rutas siguen accesibles a propósito, para que un
 * administrador pueda probar el asistente del comercial (que vive bajo
 * `/empleado`) antes de abrirlo. Quien no tiene el módulo contratado no pasa el
 * gate del servidor, que es donde se decide de verdad.
 */

export interface ContextoVisibilidadMenu {
  /** Rol de quien mira el menú. */
  rol: string;
  /** El plan no incluye el módulo. */
  bloqueada: boolean;
  /** Contratado pero aún sin abrir al equipo. */
  enRodaje: boolean;
  /** Esta persona lo estrena durante el rodaje (`User.cierreTurnoPiloto`). */
  accesoAnticipado?: boolean;
}

export function moduloCierreVisibleEnMenu(ctx: ContextoVisibilidadMenu): boolean {
  if (ctx.bloqueada) return false;
  if (ctx.enRodaje) return ctx.rol === "OWNER" || ctx.accesoAnticipado === true;
  return true;
}
