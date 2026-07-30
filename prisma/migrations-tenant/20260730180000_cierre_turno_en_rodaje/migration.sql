-- 20260730180000_cierre_turno_en_rodaje
--
-- Interruptor "en rodaje" del módulo de cierre de turno.
--
-- El problema que resuelve: contratar el módulo hacía aparecer de golpe una
-- sección nueva en el menú de toda la plantilla, antes de que el cliente
-- hubiera subido su catálogo de artículos o repartido los PIN de recogida. La
-- gente entra, encuentra pantallas a medio configurar y pregunta.
--
-- Con esto, el módulo arranca visible solo para administración (`true` por
-- defecto) y se abre al equipo con un clic desde Configuración → Catálogo de
-- ventas cuando ya está preparado.
--
-- Idempotente: el entrypoint reaplica todas las migraciones en cada arranque.

-- AlterTable
ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "cierre_turno_en_rodaje" BOOLEAN NOT NULL DEFAULT true;
