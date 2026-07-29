-- 20260730120000_ventas_precios
--
-- Precios en el catálogo de ventas (módulo "Cierre de turno", entrega 3).
--
--   ArticuloVenta.precio ................. precio unitario, opcional
--   ConfiguracionEmpresa.ventas_precios_activos ... interruptor por cliente
--
-- Hay clientes que solo cuentan unidades vendidas y otros que necesitan el
-- importe para cruzarlo con la caja. En vez de decidirlo por ellos, el precio
-- es opcional y se enciende por tenant desde Configuración.
--
-- Idempotente: el entrypoint reaplica todas las migraciones de tenant en cada
-- arranque.

-- AlterTable
ALTER TABLE "ArticuloVenta" ADD COLUMN IF NOT EXISTS "precio" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "ventas_precios_activos" BOOLEAN NOT NULL DEFAULT false;
