-- Bot de Telegram para gestión de tickets.
-- Aditiva: dos tablas nuevas en el schema master. Sin impacto en tenants.
-- Idempotente (IF NOT EXISTS) para tolerar re-deploy / lazy migrations.

CREATE TABLE IF NOT EXISTS "master"."telegram_recipients" (
  "id"                 TEXT PRIMARY KEY,
  "label"              TEXT NOT NULL,
  "chat_id"            TEXT,
  "pairing_code"       TEXT,
  "pairing_expires_at" TIMESTAMP(3),
  "active"             BOOLEAN NOT NULL DEFAULT true,
  "can_operate"        BOOLEAN NOT NULL DEFAULT true,
  "linked_at"          TIMESTAMP(3),
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_recipients_chat_id_key"
  ON "master"."telegram_recipients" ("chat_id");

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_recipients_pairing_code_key"
  ON "master"."telegram_recipients" ("pairing_code");

CREATE INDEX IF NOT EXISTS "telegram_recipients_active_idx"
  ON "master"."telegram_recipients" ("active");

CREATE TABLE IF NOT EXISTS "master"."telegram_sessions" (
  "chat_id"    TEXT NOT NULL,
  "tg_user_id" TEXT NOT NULL,
  "ticket_id"  TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_sessions_pkey" PRIMARY KEY ("chat_id", "tg_user_id")
);
