-- 20260720130000_user_auto_turno_oficina
--
-- User.auto_turno_oficina (Boolean, default false): marca a un empleado
-- para el "horario de oficina automático". Al publicar el cuadrante, los
-- días laborables (L-V) de la semana que queden sin ningún turno en ninguna
-- sede se rellenan automáticamente con un turno de 09:00–17:00 en la sede
-- "Oficina". Ver src/lib/turnos/rellenar-oficina.ts.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "auto_turno_oficina" BOOLEAN NOT NULL DEFAULT false;
