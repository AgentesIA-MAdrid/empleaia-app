-- Invitaciones a nuevos super-admins del panel (admin.empleaia.es).
-- Aditiva: tabla nueva en el schema master. Sin impacto en tenants existentes.
-- Idempotente (IF NOT EXISTS) para tolerar re-deploy / lazy migrations.

CREATE TABLE IF NOT EXISTS "master"."admin_invitations" (
  "id"             TEXT PRIMARY KEY,
  "email"          TEXT NOT NULL,
  "role"           "master"."PlatformRol" NOT NULL DEFAULT 'SUPPORT',
  "token"          TEXT NOT NULL,
  "invited_by_id"  TEXT,
  "expires_at"     TIMESTAMP(3) NOT NULL,
  "accepted_at"    TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_invitations_token_key"
  ON "master"."admin_invitations" ("token");
