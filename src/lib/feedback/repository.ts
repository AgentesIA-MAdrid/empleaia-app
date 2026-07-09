// Acceso a datos del ticketing (portado de TuFacturaIA, reescrito de Supabase a
// Prisma sobre el schema `master`). Es la frontera Supabase→Prisma: devuelve
// DTOs en `snake_case` idénticos a los del paquete original para que endpoints
// y frontend porten con cambios mínimos. `org_*` del original mapea a `tenant_*`.

import { prismaMaster } from "@/lib/prisma";
import { canEnqueue, applyJobEvent, type JobStatus } from "@/lib/feedback/ai-jobs";

export interface FeedbackTicket {
  id: string;
  numero: number;
  org_id: string; // = tenantId
  user_id: string | null;
  tipo: "bug" | "mejora" | "pregunta";
  descripcion: string;
  pagina: string;
  screenshot_paths: string[] | null; // ids de FeedbackAdjunto
  estado: "nuevo" | "en_revision" | "en_desarrollo" | "resuelto" | "descartado";
  notas_internas: string | null;
  visto_por_user: boolean;
  created_at: string;
  updated_at: string;
}

const ISO = (d: Date): string => d.toISOString();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTicket(t: any): FeedbackTicket {
  return {
    id: t.id,
    numero: t.numero,
    org_id: t.tenantId,
    user_id: t.userId ?? null,
    tipo: t.tipo,
    descripcion: t.descripcion,
    pagina: t.pagina,
    screenshot_paths: (t.adjuntos ?? []).map((a: { id: string }) => a.id),
    estado: t.estado,
    notas_internas: t.notasInternas ?? null,
    visto_por_user: t.vistoPorUser,
    created_at: ISO(t.createdAt),
    updated_at: ISO(t.updatedAt),
  };
}

export interface CreateTicketInput {
  org_id: string; // tenantId
  user_id: string | null;
  user_email?: string | null;
  user_nombre?: string | null;
  tipo: "bug" | "mejora" | "pregunta";
  descripcion: string;
  pagina: string;
  screenshot_paths?: string[]; // ids de FeedbackAdjunto ya subidos
}

export async function createTicket(
  input: CreateTicketInput,
): Promise<{ id: string; numero: number; created_at: string }> {
  const ticket = await prismaMaster.feedbackTicket.create({
    data: {
      tenantId: input.org_id,
      userId: input.user_id,
      userEmail: input.user_email ?? null,
      userNombre: input.user_nombre ?? null,
      tipo: input.tipo,
      descripcion: input.descripcion,
      pagina: input.pagina,
    },
    select: { id: true, numero: true, createdAt: true },
  });
  // Enlaza las capturas ya subidas (FeedbackAdjunto huérfanos) a este ticket.
  if (input.screenshot_paths?.length) {
    await prismaMaster.feedbackAdjunto.updateMany({
      where: { id: { in: input.screenshot_paths }, ticketId: null, messageId: null, jobId: null },
      data: { ticketId: ticket.id },
    });
  }
  return { id: ticket.id, numero: ticket.numero, created_at: ISO(ticket.createdAt) };
}

export interface TicketSummary {
  id: string;
  numero: number;
  tipo: "bug" | "mejora" | "pregunta";
  descripcion: string;
  estado: "nuevo" | "en_revision" | "en_desarrollo" | "resuelto" | "descartado";
  visto_por_user: boolean;
  /** Autor del último mensaje público del hilo (null si no hay respuestas). */
  ultimo_autor: "admin" | "user" | null;
  created_at: string;
}

export async function listByUser(userId: string): Promise<TicketSummary[]> {
  const rows = await prismaMaster.feedbackTicket.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      numero: true,
      tipo: true,
      descripcion: true,
      estado: true,
      vistoPorUser: true,
      createdAt: true,
      // Último mensaje público del hilo (para saber de quién es la última palabra).
      mensajes: {
        where: { internal: false },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { autor: true },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    numero: r.numero,
    tipo: r.tipo,
    descripcion: r.descripcion,
    estado: r.estado,
    visto_por_user: r.vistoPorUser,
    ultimo_autor: r.mensajes[0]?.autor ?? null,
    created_at: ISO(r.createdAt),
  }));
}

export async function markTicketsSeenByUser(userId: string): Promise<void> {
  await prismaMaster.feedbackTicket.updateMany({
    where: { userId, vistoPorUser: false },
    data: { vistoPorUser: true },
  });
}

export interface AdminTicket extends FeedbackTicket {
  org_nombre: string;
  user_email: string | null;
  user_name: string | null;
  /** Autor del último mensaje público del hilo (null si no hay respuestas). */
  ultimo_autor: "admin" | "user" | null;
}

export async function listAll(filters?: {
  tipo?: string;
  estado?: string;
  orgId?: string;
}): Promise<AdminTicket[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (filters?.tipo) where.tipo = filters.tipo;
  if (filters?.estado) where.estado = filters.estado;
  if (filters?.orgId) where.tenantId = filters.orgId;

  const rows = await prismaMaster.feedbackTicket.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      tenant: { select: { name: true } },
      adjuntos: { select: { id: true } },
      mensajes: {
        where: { internal: false },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { autor: true },
      },
    },
  });
  return rows.map((t) => ({
    ...toTicket(t),
    org_nombre: t.tenant?.name ?? "",
    user_email: t.userEmail ?? null,
    user_name: t.userNombre ?? null,
    ultimo_autor: t.mensajes[0]?.autor ?? null,
  }));
}

/** Tickets sin atender ('nuevo') + timestamp del más reciente (banner superadmin). */
export async function countNuevos(): Promise<{ count: number; latestCreatedAt: string | null }> {
  const [count, latest] = await Promise.all([
    prismaMaster.feedbackTicket.count({ where: { estado: "nuevo" } }),
    prismaMaster.feedbackTicket.findFirst({
      where: { estado: "nuevo" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return { count, latestCreatedAt: latest ? ISO(latest.createdAt) : null };
}

export async function updateTicket(
  id: string,
  data: { estado?: string; notas_internas?: string; visto_por_user?: boolean },
): Promise<FeedbackTicket> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: any = {};
  if (data.estado !== undefined) patch.estado = data.estado;
  if (data.notas_internas !== undefined) patch.notasInternas = data.notas_internas;
  if (data.visto_por_user !== undefined) patch.vistoPorUser = data.visto_por_user;
  const t = await prismaMaster.feedbackTicket.update({
    where: { id },
    data: patch,
    include: { adjuntos: { select: { id: true } } },
  });
  return toTicket(t);
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  autor: "admin" | "user";
  user_id: string | null;
  cuerpo: string;
  internal: boolean;
  is_ai: boolean;
  adjunto_path: string | null; // id de FeedbackAdjunto
  created_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMessage(m: any): TicketMessage {
  return {
    id: m.id,
    ticket_id: m.ticketId,
    autor: m.autor,
    user_id: m.userId ?? null,
    cuerpo: m.cuerpo,
    internal: m.internal,
    is_ai: m.isAi,
    adjunto_path: m.adjunto?.id ?? null,
    created_at: ISO(m.createdAt),
  };
}

export async function listMessages(
  ticketId: string,
  opts: { includeInternal?: boolean } = {},
): Promise<TicketMessage[]> {
  const rows = await prismaMaster.feedbackTicketMessage.findMany({
    where: { ticketId, ...(opts.includeInternal === false ? { internal: false } : {}) },
    orderBy: { createdAt: "asc" },
    include: { adjunto: { select: { id: true } } },
  });
  return rows.map(toMessage);
}

export async function addMessage(input: {
  ticket_id: string;
  autor: "admin" | "user";
  user_id: string | null;
  cuerpo: string;
  internal?: boolean;
  is_ai?: boolean;
  adjunto_path?: string | null; // id de FeedbackAdjunto a enlazar
}): Promise<TicketMessage> {
  const m = await prismaMaster.feedbackTicketMessage.create({
    data: {
      ticketId: input.ticket_id,
      autor: input.autor,
      userId: input.user_id,
      cuerpo: input.cuerpo,
      internal: input.internal ?? false,
      isAi: input.is_ai ?? false,
    },
  });
  if (input.adjunto_path) {
    await prismaMaster.feedbackAdjunto.updateMany({
      where: { id: input.adjunto_path },
      data: { messageId: m.id, ticketId: null, jobId: null },
    });
  }
  const full = await prismaMaster.feedbackTicketMessage.findUnique({
    where: { id: m.id },
    include: { adjunto: { select: { id: true } } },
  });
  return toMessage(full);
}

/** True si el adjunto existe y está huérfano (sin ticket/mensaje/job). Lo usa
 *  el route de respuesta del usuario antes de enlazarlo a su mensaje, para que
 *  no pueda referenciar adjuntos ajenos ya asignados. */
export async function adjuntoIsOrphan(id: string): Promise<boolean> {
  const adj = await prismaMaster.feedbackAdjunto.findUnique({
    where: { id },
    select: { ticketId: true, messageId: true, jobId: true },
  });
  return !!adj && adj.ticketId === null && adj.messageId === null && adj.jobId === null;
}

/** True si el adjunto pertenece al ticket (captura del ticket, adjunto de un
 *  mensaje del hilo, o adjunto del resumen de un job del ticket). Autoriza el
 *  GET de bytes del lado usuario. */
export async function adjuntoBelongsToTicket(adjuntoId: string, ticketId: string): Promise<boolean> {
  const adj = await prismaMaster.feedbackAdjunto.findUnique({
    where: { id: adjuntoId },
    select: {
      ticketId: true,
      message: { select: { ticketId: true } },
      job: { select: { ticketId: true } },
    },
  });
  if (!adj) return false;
  return adj.ticketId === ticketId || adj.message?.ticketId === ticketId || adj.job?.ticketId === ticketId;
}

export async function getTicketById(id: string): Promise<FeedbackTicket | null> {
  const t = await prismaMaster.feedbackTicket.findUnique({
    where: { id },
    include: { adjuntos: { select: { id: true } } },
  });
  return t ? toTicket(t) : null;
}

/** Nombre de la empresa (tenant) de un ticket — para el email de resultado. */
export async function getTicketOrgName(tenantId: string): Promise<string> {
  const t = await prismaMaster.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  return t?.name ?? "";
}

/** Email del usuario que abrió el ticket (denormalizado en el propio ticket). */
export async function getTicketUserEmail(ticketId: string): Promise<string | null> {
  const t = await prismaMaster.feedbackTicket.findUnique({
    where: { id: ticketId },
    select: { userEmail: true },
  });
  return t?.userEmail ?? null;
}

// ─── Jobs "Resolver con Claude" ────────────────────────────────────────────

export interface AiJob {
  id: string;
  ticket_id: string;
  status: JobStatus;
  model: string | null;
  pr_url: string | null;
  branch: string | null;
  error: string | null;
  created_by: string | null;
  prompt_override: string | null;
  resumen_cliente: string | null;
  resumen_adjunto_path: string | null;
  resumen_publicado_at: string | null;
  created_at: string;
  updated_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toJob(j: any): AiJob {
  return {
    id: j.id,
    ticket_id: j.ticketId,
    status: j.status,
    model: j.model ?? null,
    pr_url: j.prUrl ?? null,
    branch: j.branch ?? null,
    error: j.error ?? null,
    created_by: j.createdBy ?? null,
    prompt_override: j.promptOverride ?? null,
    resumen_cliente: j.resumenCliente ?? null,
    resumen_adjunto_path: j.resumenAdjunto?.id ?? null,
    resumen_publicado_at: j.resumenPublicadoAt ? ISO(j.resumenPublicadoAt) : null,
    created_at: ISO(j.createdAt),
    updated_at: ISO(j.updatedAt),
  };
}

const JOB_INCLUDE = { resumenAdjunto: { select: { id: true } } } as const;

export async function getLatestJobStatusByTickets(
  ticketIds: string[],
): Promise<Record<string, { status: JobStatus; pr_url: string | null }>> {
  if (ticketIds.length === 0) return {};
  const rows = await prismaMaster.feedbackAiJob.findMany({
    where: { ticketId: { in: ticketIds } },
    orderBy: { createdAt: "desc" },
    select: { ticketId: true, status: true, prUrl: true },
  });
  const out: Record<string, { status: JobStatus; pr_url: string | null }> = {};
  for (const r of rows) if (!(r.ticketId in out)) out[r.ticketId] = { status: r.status, pr_url: r.prUrl ?? null };
  return out;
}

export async function getAiJobById(jobId: string): Promise<AiJob | null> {
  const j = await prismaMaster.feedbackAiJob.findUnique({ where: { id: jobId }, include: JOB_INCLUDE });
  return j ? toJob(j) : null;
}

export async function getLatestAiJob(ticketId: string): Promise<AiJob | null> {
  const j = await prismaMaster.feedbackAiJob.findFirst({
    where: { ticketId },
    orderBy: { createdAt: "desc" },
    include: JOB_INCLUDE,
  });
  return j ? toJob(j) : null;
}

/** Kill-switch del runner. Sin tabla de config global → habilitado por env:
 *  FEEDBACK_RUNNER_DISABLED=1 lo apaga. Fail-open (default habilitado). */
export async function isRunnerEnabled(): Promise<boolean> {
  return process.env.FEEDBACK_RUNNER_DISABLED !== "1";
}

/** Consume (single-use) un token de acción del email. Inserta el jti: si ya
 *  existía (PK duplicada) ya se usó → false. */
export async function consumeActionToken(
  jti: string,
  ticketId: string,
  action: string,
): Promise<boolean> {
  try {
    await prismaMaster.feedbackActionToken.create({ data: { jti, ticketId, action } });
    return true;
  } catch {
    return false;
  }
}

/** Encola un job nuevo si no hay otro vivo para el ticket (dedupe). */
export async function enqueueAiJob(
  ticketId: string,
  createdBy: string | null,
  model = "opus",
  promptOverride?: string | null,
): Promise<{ ok: true; job: AiJob } | { ok: false; reason: "job_activo" }> {
  const latest = await getLatestAiJob(ticketId);
  if (!canEnqueue(latest)) return { ok: false, reason: "job_activo" };
  const j = await prismaMaster.feedbackAiJob.create({
    data: { ticketId, createdBy, model, promptOverride: promptOverride?.trim() || null },
    include: JOB_INCLUDE,
  });
  return { ok: true, job: toJob(j) };
}

/** Reclama atómicamente el siguiente job encolado vía RPC (FOR UPDATE SKIP LOCKED). */
export async function claimNextAiJob(): Promise<AiJob | null> {
  // El RPC devuelve la fila completa o NULL (cola vacía).
  const rows = await prismaMaster.$queryRawUnsafe<
    Array<Record<string, unknown>>
  >(`SELECT * FROM "master".claim_next_feedback_ai_job()`);
  const row = rows?.[0];
  if (!row || !row.id) return null;
  // Mapea snake_case (columnas reales) → AiJob.
  return {
    id: String(row.id),
    ticket_id: String(row.ticket_id),
    status: row.status as JobStatus,
    model: (row.model as string) ?? null,
    pr_url: (row.pr_url as string) ?? null,
    branch: (row.branch as string) ?? null,
    error: (row.error as string) ?? null,
    created_by: (row.created_by as string) ?? null,
    prompt_override: (row.prompt_override as string) ?? null,
    resumen_cliente: (row.resumen_cliente as string) ?? null,
    resumen_adjunto_path: null,
    resumen_publicado_at: row.resumen_publicado_at ? ISO(new Date(row.resumen_publicado_at as string)) : null,
    created_at: ISO(new Date(row.created_at as string)),
    updated_at: ISO(new Date(row.updated_at as string)),
  };
}

/** Aplica una transición de estado reportada por el runner (valida + idempotente). */
export async function transitionAiJob(
  jobId: string,
  event: JobStatus,
  extra?: { pr_url?: string; branch?: string; error?: string },
): Promise<{ ok: true; job: AiJob; changed: boolean } | { ok: false; reason: string }> {
  const current = await prismaMaster.feedbackAiJob.findUnique({ where: { id: jobId } });
  if (!current) return { ok: false, reason: "job_no_encontrado" };
  const transition = applyJobEvent(current.status, event);
  if (!transition.ok) return { ok: false, reason: transition.reason };
  const changed = transition.next !== current.status;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: any = { status: transition.next };
  if (extra?.pr_url !== undefined) patch.prUrl = extra.pr_url;
  if (extra?.branch !== undefined) patch.branch = extra.branch;
  if (extra?.error !== undefined) patch.error = extra.error;
  const j = await prismaMaster.feedbackAiJob.update({ where: { id: jobId }, data: patch, include: JOB_INCLUDE });
  return { ok: true, job: toJob(j), changed };
}

// ─── Eventos de progreso en vivo ───────────────────────────────────────────

export type JobEventPhase =
  | "preparando"
  | "analizando"
  | "verificando"
  | "subiendo"
  | "pr_abierto"
  | "sin_cambios"
  | "fallido";

export interface AiJobEvent {
  id: string;
  job_id: string;
  phase: JobEventPhase;
  detail: string | null;
  created_at: string;
}

export async function addJobEvent(
  jobId: string,
  phase: JobEventPhase,
  detail?: string | null,
): Promise<void> {
  await prismaMaster.feedbackAiJobEvent.create({ data: { jobId, phase, detail: detail ?? null } });
}

export async function listJobEvents(jobId: string): Promise<AiJobEvent[]> {
  const rows = await prismaMaster.feedbackAiJobEvent.findMany({
    where: { jobId },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return rows.map((e) => ({
    id: e.id,
    job_id: e.jobId,
    phase: e.phase,
    detail: e.detail ?? null,
    created_at: ISO(e.createdAt),
  }));
}

/** Registra el resultado de un job terminal: diagnóstico (mensaje interno is_ai)
 *  + resumen/adjunto como borrador en el job. El ticket avanza solo desde 'nuevo'. */
export async function recordJobOutcome(
  job: AiJob,
  outcome: { diagnostico?: string | null; resumen?: string | null; adjuntoPath?: string | null },
): Promise<void> {
  const diagnostico = outcome.diagnostico?.trim() || "";
  if (diagnostico) {
    await addMessage({
      ticket_id: job.ticket_id,
      autor: "admin",
      user_id: null,
      cuerpo: diagnostico,
      is_ai: true,
      internal: true,
    });
  }
  const resumen = outcome.resumen?.trim() || null;
  const adjuntoPath = outcome.adjuntoPath?.trim() || null;
  if (resumen) {
    await prismaMaster.feedbackAiJob.update({ where: { id: job.id }, data: { resumenCliente: resumen } });
  }
  if (adjuntoPath) {
    await prismaMaster.feedbackAdjunto.updateMany({
      where: { id: adjuntoPath },
      data: { jobId: job.id, ticketId: null, messageId: null },
    });
  }
  const ticket = await getTicketById(job.ticket_id);
  if (ticket && ticket.estado === "nuevo") {
    await updateTicket(job.ticket_id, { estado: "en_revision" });
  }
}

export async function setAiJobResumenDraft(jobId: string, resumen: string): Promise<void> {
  await prismaMaster.feedbackAiJob.update({
    where: { id: jobId },
    data: { resumenCliente: resumen.trim() || null },
  });
}

/** Localiza el job más reciente cuyo PR/rama coincide (webhook de merge). */
export async function findAiJobByBranchOrUrl(
  branch?: string | null,
  prUrl?: string | null,
): Promise<AiJob | null> {
  const or: Array<{ branch: string } | { prUrl: string }> = [];
  if (branch) or.push({ branch });
  if (prUrl) or.push({ prUrl });
  if (or.length === 0) return null;
  const j = await prismaMaster.feedbackAiJob.findFirst({
    where: { OR: or },
    orderBy: { createdAt: "desc" },
    include: JOB_INCLUDE,
  });
  return j ? toJob(j) : null;
}

/** Fija el estado del job (p. ej. pr_abierto → desplegado tras el merge). */
export async function setAiJobStatus(jobId: string, status: JobStatus): Promise<void> {
  await prismaMaster.feedbackAiJob.update({
    where: { id: jobId },
    data: { status },
  });
}

/** PR cerrado SIN mergear (descartado por el equipo): si su job sigue en
 *  `pr_abierto`, lo saca de ese estado a `fallido` con un motivo claro, para
 *  que no quede colgado en el panel. Solo actúa sobre jobs en `pr_abierto`. */
export async function discardJobForClosedPr(
  branch?: string | null,
  prUrl?: string | null,
): Promise<{ matched: boolean }> {
  const job = await findAiJobByBranchOrUrl(branch, prUrl);
  if (!job || job.status !== "pr_abierto") return { matched: false };
  await prismaMaster.feedbackAiJob.update({
    where: { id: job.id },
    data: { status: "fallido", error: "PR cerrado sin mergear (descartado)" },
  });
  return { matched: true };
}

/** Publica el resumen (borrador) al cliente: lo vuelca al hilo como mensaje
 *  público (is_ai), sella resumen_publicado_at y enciende el badge del usuario. */
export async function publishResumenToClient(
  jobId: string,
): Promise<
  | { ok: true; message: TicketMessage; ticket: FeedbackTicket }
  | { ok: false; reason: "sin_resumen" | "job_no_encontrado" | "ya_publicado" }
> {
  const job = await prismaMaster.feedbackAiJob.findUnique({
    where: { id: jobId },
    include: { resumenAdjunto: { select: { id: true } } },
  });
  if (!job) return { ok: false, reason: "job_no_encontrado" };
  if (job.resumenPublicadoAt) return { ok: false, reason: "ya_publicado" };
  const cuerpo = (job.resumenCliente ?? "").trim();
  if (!cuerpo) return { ok: false, reason: "sin_resumen" };

  const message = await addMessage({
    ticket_id: job.ticketId,
    autor: "admin",
    user_id: null,
    cuerpo,
    is_ai: true,
    internal: false,
    adjunto_path: job.resumenAdjunto?.id ?? null,
  });
  await prismaMaster.feedbackAiJob.update({
    where: { id: jobId },
    data: { resumenPublicadoAt: new Date() },
  });
  const ticket = await getTicketById(job.ticketId);
  const updated = await updateTicket(job.ticketId, {
    visto_por_user: false,
    ...(ticket?.estado === "nuevo" ? { estado: "en_revision" } : {}),
  });
  return { ok: true, message, ticket: updated };
}
