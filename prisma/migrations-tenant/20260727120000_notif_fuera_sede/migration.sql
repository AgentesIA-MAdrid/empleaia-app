-- 20260727120000_notif_fuera_sede
--
-- Flag por tenant: avisar por email a OWNER + managers de la sede cuando un
-- empleado ficha fuera del radio de su sede (`Tienda.radio`, 200 m por
-- defecto). Opción en Configuración → Notificaciones. Idempotente.
ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "notifFueraSede" BOOLEAN NOT NULL DEFAULT true;
