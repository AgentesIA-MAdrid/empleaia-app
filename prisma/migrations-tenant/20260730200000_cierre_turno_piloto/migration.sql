-- 20260730200000_cierre_turno_piloto
--
-- Acceso anticipado al módulo de cierre de turno, por persona.
--
-- El interruptor de rodaje es de todo o nada: administración lo ve y el resto
-- no. Falta el caso real de estrenar el módulo con UNA persona —la que se
-- presta a probarlo en su tienda— sin abrírselo a la plantilla entera.
--
-- La alternativa era hacerla administradora, y eso le daría acceso a nóminas,
-- empleados y canal de denuncias. Un flag por usuario es lo mínimo que resuelve
-- el caso sin regalar permisos que no tienen nada que ver.
--
-- Idempotente: el entrypoint reaplica todas las migraciones en cada arranque.

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "cierre_turno_piloto" BOOLEAN NOT NULL DEFAULT false;
