-- 20260609120000_perfil_completado
--
-- User.perfil_completado (Boolean): marca si el empleado/manager ya
-- rellenó sus datos personales obligatorios (DNI, teléfono, fecha de
-- nacimiento) en su primer acceso. Los usuarios que YA tienen los tres
-- datos se marcan como completado para no molestarles.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "perfil_completado" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
  SET "perfil_completado" = true
  WHERE "dni" IS NOT NULL
    AND "telefono" IS NOT NULL
    AND "fechaNacimiento" IS NOT NULL;
