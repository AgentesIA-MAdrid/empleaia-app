-- CreateEnum
CREATE TYPE "master"."FeedbackTipo" AS ENUM ('bug', 'mejora', 'pregunta');

-- CreateEnum
CREATE TYPE "master"."FeedbackEstado" AS ENUM ('nuevo', 'en_revision', 'resuelto', 'descartado');

-- CreateEnum
CREATE TYPE "master"."FeedbackAutor" AS ENUM ('admin', 'user');

-- CreateEnum
CREATE TYPE "master"."FeedbackJobStatus" AS ENUM ('encolado', 'ejecutando', 'pr_abierto', 'sin_cambios', 'fallido');

-- CreateEnum
CREATE TYPE "master"."FeedbackJobPhase" AS ENUM ('preparando', 'analizando', 'verificando', 'subiendo', 'pr_abierto', 'sin_cambios', 'fallido');

-- DropForeignKey
ALTER TABLE "master"."api_tokens" DROP CONSTRAINT "api_tokens_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "master"."audit_log" DROP CONSTRAINT "audit_log_super_admin_id_fkey";

-- DropIndex
DROP INDEX "master"."audit_log_created_at_idx";

-- DropIndex
DROP INDEX "master"."audit_log_severity_created_at_idx";

-- CreateTable
CREATE TABLE "master"."feedback_tickets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "user_email" TEXT,
    "user_nombre" TEXT,
    "tipo" "master"."FeedbackTipo" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "pagina" TEXT NOT NULL,
    "estado" "master"."FeedbackEstado" NOT NULL DEFAULT 'nuevo',
    "notas_internas" TEXT,
    "visto_por_user" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."feedback_ticket_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "autor" "master"."FeedbackAutor" NOT NULL,
    "user_id" TEXT,
    "cuerpo" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "is_ai" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."feedback_ai_jobs" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "status" "master"."FeedbackJobStatus" NOT NULL DEFAULT 'encolado',
    "model" TEXT,
    "pr_url" TEXT,
    "branch" TEXT,
    "error" TEXT,
    "prompt_override" TEXT,
    "resumen_cliente" TEXT,
    "resumen_publicado_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."feedback_ai_job_events" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "phase" "master"."FeedbackJobPhase" NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_ai_job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."feedback_action_tokens" (
    "jti" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_action_tokens_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "master"."feedback_adjuntos" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT,
    "message_id" TEXT,
    "job_id" TEXT,
    "data" BYTEA NOT NULL,
    "content_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_adjuntos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_tickets_tenant_id_idx" ON "master"."feedback_tickets"("tenant_id");

-- CreateIndex
CREATE INDEX "feedback_tickets_estado_idx" ON "master"."feedback_tickets"("estado");

-- CreateIndex
CREATE INDEX "feedback_tickets_created_at_idx" ON "master"."feedback_tickets"("created_at");

-- CreateIndex
CREATE INDEX "feedback_ticket_messages_ticket_id_created_at_idx" ON "master"."feedback_ticket_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_ai_jobs_status_idx" ON "master"."feedback_ai_jobs"("status");

-- CreateIndex
CREATE INDEX "feedback_ai_jobs_ticket_id_created_at_idx" ON "master"."feedback_ai_jobs"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_ai_job_events_job_id_created_at_idx" ON "master"."feedback_ai_job_events"("job_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_adjuntos_message_id_key" ON "master"."feedback_adjuntos"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_adjuntos_job_id_key" ON "master"."feedback_adjuntos"("job_id");

-- CreateIndex
CREATE INDEX "feedback_adjuntos_ticket_id_idx" ON "master"."feedback_adjuntos"("ticket_id");

-- CreateIndex
CREATE INDEX "audit_log_severity_created_at_idx" ON "master"."audit_log"("severity", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "master"."audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "master"."api_tokens" ADD CONSTRAINT "api_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "master"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master"."audit_log" ADD CONSTRAINT "audit_log_super_admin_id_fkey" FOREIGN KEY ("super_admin_id") REFERENCES "master"."super_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master"."feedback_tickets" ADD CONSTRAINT "feedback_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "master"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master"."feedback_ticket_messages" ADD CONSTRAINT "feedback_ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "master"."feedback_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master"."feedback_ai_jobs" ADD CONSTRAINT "feedback_ai_jobs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "master"."feedback_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master"."feedback_ai_job_events" ADD CONSTRAINT "feedback_ai_job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "master"."feedback_ai_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master"."feedback_action_tokens" ADD CONSTRAINT "feedback_action_tokens_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "master"."feedback_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master"."feedback_adjuntos" ADD CONSTRAINT "feedback_adjuntos_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "master"."feedback_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master"."feedback_adjuntos" ADD CONSTRAINT "feedback_adjuntos_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "master"."feedback_ticket_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master"."feedback_adjuntos" ADD CONSTRAINT "feedback_adjuntos_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "master"."feedback_ai_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Claim atómico del siguiente job encolado (FOR UPDATE SKIP LOCKED).
-- Devuelve NULL real si la cola está vacía (no una "fila de nulls").
-- Lo invoca solo el endpoint interno /claim (service-role).
CREATE OR REPLACE FUNCTION "master".claim_next_feedback_ai_job()
RETURNS "master"."feedback_ai_jobs"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = "master", public
AS $$
DECLARE
  claimed "master"."feedback_ai_jobs";
BEGIN
  UPDATE "master"."feedback_ai_jobs"
     SET status = 'ejecutando'
   WHERE id = (
     SELECT id FROM "master"."feedback_ai_jobs"
      WHERE status = 'encolado'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING * INTO claimed;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN claimed;
END;
$$;
