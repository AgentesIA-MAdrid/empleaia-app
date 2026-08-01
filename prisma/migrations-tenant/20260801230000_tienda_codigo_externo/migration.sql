-- Código de cada punto de venta en el sistema de facturación (ticket 4b8e1d05).
--
-- Su export identifica la tienda como "MY128022 - NEKSUS MADRID CC PLENILUNIO",
-- y los nombres no coinciden con los nuestros ("NEKSUS PLENILUNIO"). El código
-- sí es estable, así que es por lo que se casa cada línea con su tienda.
ALTER TABLE "Tienda" ADD COLUMN IF NOT EXISTS "codigo_externo" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Tienda_codigo_externo_key" ON "Tienda" ("codigo_externo");
