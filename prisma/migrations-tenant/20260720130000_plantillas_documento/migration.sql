-- 20260720130000_plantillas_documento
--
-- Plantillas de documentos: el OWNER/MANAGER sube un documento contractual una
-- vez, marca los campos que el empleado tendrá que rellenar y lo envía a uno o
-- varios empleados (como parte del alta o adjuntándolo desde el envío de
-- documentos). Cada envío materializa un Documento copiando los campos.
-- Aditivo e idempotente (lazy migrations, ver AGENTS.md §5.1).

-- Campos que viajan al Documento enviado desde una plantilla + respuestas del
-- empleado (alineadas por índice). Null en documentos normales.
ALTER TABLE "Documento" ADD COLUMN IF NOT EXISTS "campos"           JSONB;
ALTER TABLE "Documento" ADD COLUMN IF NOT EXISTS "camposRespuestas" JSONB;

CREATE TABLE IF NOT EXISTS "PlantillaDocumento" (
  "id"             TEXT NOT NULL,
  "nombre"         TEXT NOT NULL,
  "descripcion"    TEXT,
  "url"            TEXT,
  "tipo"           TEXT NOT NULL DEFAULT 'otro',
  "campos"         JSONB NOT NULL DEFAULT '[]',
  "solicitarFirma" BOOLEAN NOT NULL DEFAULT false,
  "orden"          INTEGER NOT NULL DEFAULT 0,
  "createdById"    TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlantillaDocumento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PlantillaDocumento_createdById_idx"
  ON "PlantillaDocumento"("createdById");

-- FK createdById -> User(id). pg_constraint registra las FK, así que el patrón
-- IF NOT EXISTS es seguro (ver AGENTS.md §5.1).
DO $$ BEGIN
  ALTER TABLE "PlantillaDocumento"
    ADD CONSTRAINT "PlantillaDocumento_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
