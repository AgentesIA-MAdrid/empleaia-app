-- 20260626130000_turno_aviso_fichaje
--
-- Turno.aviso_fichaje_enviado_at: marca de envío del aviso de "olvido de
-- fichaje" para no repetirlo en cada pasada del cron. Idempotente.

ALTER TABLE "Turno"
  ADD COLUMN IF NOT EXISTS "aviso_fichaje_enviado_at" TIMESTAMP(3);
