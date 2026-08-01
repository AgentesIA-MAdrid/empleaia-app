/**
 * Retrasos acumulados por empleado (ticket 4a71c8d3).
 *
 * Un retraso es una ENTRADA fichada más tarde de la hora a la que empezaba su
 * turno, contando los minutos de cortesía que tenga puesta la empresa
 * (`ConfiguracionEmpresa.margenFichajeMinutos`). Se usa el mismo margen que el
 * bloqueo de fichaje fuera de horario a propósito: dos definiciones distintas de
 * "llegar tarde" en el mismo producto serían imposibles de explicar.
 *
 * Por qué hace falta: fichar después de la hora de entrada NO se ajusta ni se
 * bloquea —ajustarlo al inicio sería regalar minutos y falsear la jornada—, así
 * que el retraso se registra tal cual y no salta en ninguna parte. Este informe
 * es el que lo saca a la luz.
 *
 * Reglas del cruce:
 *
 *  - Solo cuentan los días con turno PUBLICADO: sin hora de referencia no hay
 *    retraso que medir (igual que en `horario-turno.ts`).
 *  - Con jornada partida, la entrada se compara con el turno cuyo inicio le
 *    queda más cerca. Si no, la entrada de la tarde contaría como un retraso
 *    enorme sobre el turno de la mañana.
 *  - Cada turno cuenta como mucho un retraso: si alguien ficha entrada dos
 *    veces para el mismo turno (por una corrección, o tras un fichaje anulado),
 *    vale la primera, que es cuando llegó.
 *  - Las horas se comparan en la zona del cliente. El servidor va en UTC y
 *    comparar el instante con un "HH:MM" del cuadrante sin convertir da dos
 *    horas de desfase (misma trampa que el ticket 3c91f0ab).
 *
 * Función pura: recibe los fichajes y los turnos ya leídos, así que se prueba
 * sin BD (misma pauta que `horas-contrato.ts`).
 */

import { hhmmToMin, partesEnZona } from "@/lib/fichajes/horario-turno";

/** Una entrada fichada, tal como sale de la tabla. */
export interface EntradaFichada {
  userId: string;
  /** Instante del fichaje. */
  timestamp: Date;
}

/** Un turno publicado, con su día y su hora de inicio. */
export interface TurnoPublicado {
  userId: string;
  fecha: Date;
  /** "HH:MM" */
  horaInicio: string;
}

/** Lo que se enseña de cada persona en el cuadro. */
export interface FilaRetrasos {
  userId: string;
  /** Turnos con entrada fichada en el periodo: la base sobre la que se mide. */
  turnosConEntrada: number;
  retrasos: number;
  /** Minutos acumulados de retraso. */
  minutosTotales: number;
  /** Minutos del peor retraso del periodo. */
  peorRetraso: number;
  /** Día del último retraso, "YYYY-MM-DD". null si no tuvo ninguno. */
  ultimoRetraso: string | null;
}

/** Minutos de retraso de una entrada respecto a su turno, 0 si llegó a tiempo. */
function minutosDeRetraso(entradaMin: number, inicioMin: number, margenMin: number): number {
  const limite = inicioMin + Math.max(0, margenMin);
  return entradaMin > limite ? entradaMin - inicioMin : 0;
}

/**
 * Cruza entradas con turnos y devuelve una fila por empleado, **ordenada por
 * número de retrasos** (y a igualdad, por minutos acumulados: entre dos personas
 * con tres retrasos, la de 90 minutos va antes que la de 20).
 *
 * Solo salen las personas con algún turno con entrada en el periodo. Quien no
 * tuvo turno no es que llegue puntual: es que no había nada que medir, y
 * mezclarlos en la lista con un 0 haría pensar lo contrario.
 */
export function calcularRetrasos(args: {
  entradas: EntradaFichada[];
  turnos: TurnoPublicado[];
  margenMin: number;
  zona: string;
}): FilaRetrasos[] {
  const { entradas, turnos, margenMin, zona } = args;

  // Turnos por persona y día: `Map<"userId|YYYY-MM-DD", minutos de inicio[]>`.
  const turnosPorDia = new Map<string, number[]>();
  for (const t of turnos) {
    const { fecha } = partesEnZona(t.fecha, zona);
    const clave = `${t.userId}|${fecha}`;
    const previo = turnosPorDia.get(clave);
    const inicio = hhmmToMin(t.horaInicio);
    if (previo) previo.push(inicio);
    else turnosPorDia.set(clave, [inicio]);
  }

  /**
   * Un turno ya medido: `Map<"userId|dia|inicio", minutos de retraso>`. La clave
   * lleva el turno para que la jornada partida cuente dos veces (mañana y
   * tarde), y evita que una segunda entrada del mismo turno vuelva a contar.
   */
  const medidos = new Map<string, { userId: string; dia: string; retraso: number }>();

  for (const e of entradas) {
    const { fecha: dia, minutos: entradaMin } = partesEnZona(e.timestamp, zona);
    const inicios = turnosPorDia.get(`${e.userId}|${dia}`);
    // Sin turno publicado ese día no hay hora con la que comparar.
    if (!inicios || inicios.length === 0) continue;

    // El turno al que corresponde esa entrada: el de inicio más cercano.
    let inicio = inicios[0]!;
    for (const cand of inicios) {
      if (Math.abs(entradaMin - cand) < Math.abs(entradaMin - inicio)) inicio = cand;
    }

    const clave = `${e.userId}|${dia}|${inicio}`;
    const yaMedido = medidos.get(clave);
    const retraso = minutosDeRetraso(entradaMin, inicio, margenMin);
    // Vale la PRIMERA entrada de ese turno: es cuando llegó.
    if (yaMedido) continue;
    medidos.set(clave, { userId: e.userId, dia, retraso });
  }

  const porUsuario = new Map<string, FilaRetrasos>();
  for (const m of [...medidos.values()].sort((a, b) => a.dia.localeCompare(b.dia))) {
    const fila =
      porUsuario.get(m.userId) ??
      {
        userId: m.userId,
        turnosConEntrada: 0,
        retrasos: 0,
        minutosTotales: 0,
        peorRetraso: 0,
        ultimoRetraso: null as string | null,
      };
    fila.turnosConEntrada += 1;
    if (m.retraso > 0) {
      fila.retrasos += 1;
      fila.minutosTotales += m.retraso;
      fila.peorRetraso = Math.max(fila.peorRetraso, m.retraso);
      fila.ultimoRetraso = m.dia;
    }
    porUsuario.set(m.userId, fila);
  }

  return [...porUsuario.values()].sort(
    (a, b) => b.retrasos - a.retrasos || b.minutosTotales - a.minutosTotales,
  );
}
