-- 20260720120000_firma_garabato_contratos
--
-- Firma manuscrita para "Contratos laborales y anexos": al firmar, el
-- empleado teclea su nombre y DNI/NIE y dibuja un garabato. Esos datos se
-- estampan en el margen izquierdo de cada página del documento y quedan
-- guardados en la Firma como prueba. Aditivo e idempotente.

ALTER TABLE "Firma" ADD COLUMN IF NOT EXISTS "firmante_nombre"       TEXT;
ALTER TABLE "Firma" ADD COLUMN IF NOT EXISTS "firmante_dni"          TEXT;
ALTER TABLE "Firma" ADD COLUMN IF NOT EXISTS "firma_imagen"          TEXT;
ALTER TABLE "Firma" ADD COLUMN IF NOT EXISTS "documento_firmado_url" TEXT;

-- Nueva carpeta de documentos "Contratos laborales y anexos". Se añade solo
-- si no existe ya un tipo con ese slug (respeta catálogos ya personalizados).
INSERT INTO "TipoDocumento" ("id", "nombre", "slug", "orden")
SELECT
  'tdoc_contratos_laborales',
  'Contratos laborales y anexos',
  'contratos_laborales_y_anexos',
  COALESCE((SELECT MAX("orden") FROM "TipoDocumento"), -1) + 1
WHERE NOT EXISTS (
  SELECT 1 FROM "TipoDocumento" WHERE "slug" = 'contratos_laborales_y_anexos'
);
