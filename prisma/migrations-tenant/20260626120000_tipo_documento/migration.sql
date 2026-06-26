-- 20260626120000_tipo_documento
--
-- TipoDocumento: catálogo de tipos/carpetas de documentos gestionable por el
-- OWNER. Idempotente (lazy migrations). Siembra 4 carpetas por defecto.

CREATE TABLE IF NOT EXISTS "TipoDocumento" (
  "id"        TEXT NOT NULL,
  "nombre"    TEXT NOT NULL,
  "slug"      TEXT NOT NULL,
  "orden"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TipoDocumento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TipoDocumento_slug_key" ON "TipoDocumento"("slug");

-- Siembra por defecto solo si la tabla está vacía.
INSERT INTO "TipoDocumento" ("id", "nombre", "slug", "orden")
SELECT * FROM (VALUES
  ('tdoc_fotos_check',        'Fotos de check',      'fotos_check',          0),
  ('tdoc_justificantes',      'Justificantes',       'justificantes',        1),
  ('tdoc_documentos_laborales','Documentos laborales','documentos_laborales', 2),
  ('tdoc_nominas',            'Nóminas',             'nominas',              3)
) AS seed("id","nombre","slug","orden")
WHERE NOT EXISTS (SELECT 1 FROM "TipoDocumento");
