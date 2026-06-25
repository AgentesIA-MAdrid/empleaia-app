-- 20260625120000_solicitud_fichaje
--
-- SolicitudFichaje: solicitud del empleado para registrar un fichaje
-- olvidado o corregir la hora de uno existente, con aprobación del
-- coordinador (managerId) o de un OWNER/MANAGER de su tienda. Al aprobar
-- se crea/ajusta el Fichaje correspondiente como MANUAL.
--
-- Idempotente (lazy migrations): guard del enum con EXCEPTION y resto con
-- IF NOT EXISTS, para tolerar re-ejecución sobre tenants ya migrados.

DO $$ BEGIN
  CREATE TYPE "EstadoSolicitudFichaje" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "SolicitudFichaje" (
  "id"                  TEXT NOT NULL,
  "solicitanteId"       TEXT NOT NULL,
  "aprobadorId"         TEXT,
  "clase"               TEXT NOT NULL DEFAULT 'olvido',
  "tipo"                "TipoFichaje" NOT NULL,
  "fichajeId"           TEXT,
  "fechaHora"           TIMESTAMP(3) NOT NULL,
  "motivo"              TEXT NOT NULL,
  "estado"              "EstadoSolicitudFichaje" NOT NULL DEFAULT 'PENDIENTE',
  "respuesta"           TEXT,
  "resueltaPorId"       TEXT,
  "resueltaEn"          TIMESTAMP(3),
  "fichajeResultanteId" TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SolicitudFichaje_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SolicitudFichaje_solicitanteId_idx" ON "SolicitudFichaje"("solicitanteId");
CREATE INDEX IF NOT EXISTS "SolicitudFichaje_aprobadorId_idx" ON "SolicitudFichaje"("aprobadorId");
CREATE INDEX IF NOT EXISTS "SolicitudFichaje_estado_idx" ON "SolicitudFichaje"("estado");

DO $$ BEGIN
  ALTER TABLE "SolicitudFichaje"
    ADD CONSTRAINT "SolicitudFichaje_solicitanteId_fkey"
    FOREIGN KEY ("solicitanteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "SolicitudFichaje"
    ADD CONSTRAINT "SolicitudFichaje_aprobadorId_fkey"
    FOREIGN KEY ("aprobadorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
