-- 20260630130000_tienda_manager
--
-- Tienda.managerId (TEXT, nullable): responsable de la sede como dato
-- INFORMATIVO / de visualización. No altera la jerarquía de aprobaciones
-- (el coordinador que aprueba fichajes sigue siendo User.managerId).
-- Relación propia (TiendaManager), independiente de empleados/User.tiendaId.
-- ON DELETE SET NULL: si se borra/anonimiza el usuario responsable, la sede
-- queda simplemente "sin responsable" en vez de romper la FK.

ALTER TABLE "Tienda" ADD COLUMN IF NOT EXISTS "managerId" TEXT;

ALTER TABLE "Tienda"
  ADD CONSTRAINT "Tienda_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Tienda_managerId_idx" ON "Tienda"("managerId");
