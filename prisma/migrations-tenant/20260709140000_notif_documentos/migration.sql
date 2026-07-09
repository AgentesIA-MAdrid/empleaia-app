-- 20260709140000_notif_documentos
--
-- Flag por tenant: notificar por email al empleado cuando se le sube un
-- documento (opción en Configuración → Notificaciones). Idempotente.
ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "notifDocumentos" BOOLEAN NOT NULL DEFAULT true;
