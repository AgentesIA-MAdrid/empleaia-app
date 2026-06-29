-- Anonimización de empleados (borrado RGPD-compatible).
-- Marca temporal: si no es NULL, el empleado fue "eliminado" (anonimizado) y
-- queda excluido de los listados. Idempotente.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "anonimizado_at" TIMESTAMP(3);
