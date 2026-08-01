-- Cuadre con el sistema de facturación (ticket 4b8e1d05).
--
-- Los empleados declaran lo que han vendido en su cierre, y aparte esas ventas
-- se meten a facturar en el sistema del operador. Hasta ahora no había forma de
-- cruzar las dos cosas: una venta declarada que nunca se tramitó no la veía
-- nadie.
--
-- Mismo planteamiento que MovimientoBanco: se importa el Excel del operador y
-- se cuadra por tienda y día.
CREATE TABLE IF NOT EXISTS "MovimientoFacturacion" (
  "id"          TEXT NOT NULL,
  "tiendaId"    TEXT,
  "fecha"       DATE NOT NULL,
  "importe"     DECIMAL(10,2) NOT NULL,
  "concepto"    TEXT,
  "referencia"  TEXT,
  "importadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MovimientoFacturacion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MovimientoFacturacion_referencia_key"
  ON "MovimientoFacturacion" ("referencia");
CREATE INDEX IF NOT EXISTS "MovimientoFacturacion_tiendaId_fecha_idx"
  ON "MovimientoFacturacion" ("tiendaId", "fecha");

DO $$
BEGIN
  ALTER TABLE "MovimientoFacturacion"
    ADD CONSTRAINT "MovimientoFacturacion_tiendaId_fkey"
    FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- El mapeo de columnas del export, por cliente.
ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN IF NOT EXISTS "facturacion_mapeo" JSONB;
