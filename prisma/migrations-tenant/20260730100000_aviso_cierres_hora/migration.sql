-- 20260730100000_aviso_cierres_hora
--
-- El aviso diario de cierres sin terminar pasa a mandarse a la hora LOCAL de
-- cada cliente, en vez de a una hora fija para todo el SaaS: una tienda que
-- cierra a medianoche o un cliente en Canarias recibirían el aviso a media
-- tarde, con parte de la plantilla aún trabajando, y el correo no serviría.
--
--   aviso_cierres_activo ...... se puede apagar sin perder la configuración
--   aviso_cierres_hora ........ hora local 0-23 (23 por defecto)
--   aviso_cierres_zona ........ zona IANA (Canarias = Atlantic/Canary)
--   aviso_cierres_ultimo_dia .. último día ya avisado, para no duplicar el
--                               correo si el cron se ejecuta dos veces en la
--                               misma hora
--
-- Idempotente: el entrypoint reaplica las migraciones de tenant en cada arranque.
ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "aviso_cierres_activo" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "aviso_cierres_hora" INTEGER NOT NULL DEFAULT 23,
  ADD COLUMN IF NOT EXISTS "aviso_cierres_zona" TEXT NOT NULL DEFAULT 'Europe/Madrid',
  ADD COLUMN IF NOT EXISTS "aviso_cierres_ultimo_dia" TEXT;
