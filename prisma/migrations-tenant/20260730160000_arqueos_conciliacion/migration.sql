-- 20260730160000_arqueos_conciliacion
--
-- Entrega 4 del módulo "Cierre de turno": arqueos semanales con recogida
-- firmada por PIN y conciliación (efectivo vs arqueos, tarjeta vs banco).
--
--   User.pin_recogida_intentos / pin_recogida_bloqueo_hasta
--       Bloqueo temporal tras varios PIN fallidos. Temporal a propósito: quien
--       recoge el dinero está en la tienda y no puede quedarse sin poder firmar
--       por teclear mal dos veces.
--   Arqueo.declaradoPorId / declaradoEn / notas / efectivoRecogido
--       Quién apartó el efectivo, cuándo, con qué observaciones, y cuánto se
--       llevó de verdad quien vino a recogerlo (puede dejar fondo de caja).
--   ConfiguracionEmpresa.descuadre_umbral
--       A partir de qué diferencia se marca descuadre (1 € por defecto).
--   ConfiguracionEmpresa.banco_mapeo
--       Qué columna del Excel del banco es la fecha, el importe, el concepto y
--       la referencia. Cada banco exporta distinto: el mapeo es del cliente.
--
-- Idempotente: IF NOT EXISTS en columnas y la clave ajena en un bloque que
-- tolera el duplicado, porque el entrypoint reaplica todas las migraciones de
-- tenant en cada arranque.

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "pin_recogida_intentos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pin_recogida_bloqueo_hasta" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "descuadre_umbral" DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS "banco_mapeo" JSONB;

-- AlterTable
ALTER TABLE "Arqueo"
  ADD COLUMN IF NOT EXISTS "declaradoPorId" TEXT,
  ADD COLUMN IF NOT EXISTS "declaradoEn" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "notas" TEXT,
  ADD COLUMN IF NOT EXISTS "efectivoRecogido" DECIMAL(10,2);

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "Arqueo" ADD CONSTRAINT "Arqueo_declaradoPorId_fkey"
    FOREIGN KEY ("declaradoPorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
