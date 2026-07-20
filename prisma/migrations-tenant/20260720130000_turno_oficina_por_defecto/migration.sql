-- 20260720130000_turno_oficina_por_defecto
--
-- Relleno automático del cuadrante para empleados con horario de oficina:
-- 1. Tienda.es_oficina (Boolean): marca la sede que hace de "oficina",
--    destino del relleno automático.
-- 2. User.turno_oficina_por_defecto (Boolean): empleados cuyos días sin
--    turno en ninguna tienda pasan solos a 09:00–17:00 en la oficina.
-- 3. Turno.generado_auto (Boolean): distingue los turnos creados por el
--    relleno automático de los creados a mano (para poder retirarlos
--    cuando el día se cubre en una tienda).

ALTER TABLE "Tienda"
  ADD COLUMN IF NOT EXISTS "es_oficina" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "turno_oficina_por_defecto" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Turno"
  ADD COLUMN IF NOT EXISTS "generado_auto" BOOLEAN NOT NULL DEFAULT false;
