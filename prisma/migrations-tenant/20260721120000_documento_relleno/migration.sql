-- 20260721120000_documento_relleno
--
-- Plantillas de documentos: el OWNER/MANAGER marca en el editor DÓNDE se coloca
-- cada campo. Cuando el empleado rellena sus respuestas, se genera una copia del
-- documento con esos datos estampados en su sitio, guardada en esta columna
-- (data URL de PDF). Aditivo e idempotente (lazy migrations, ver AGENTS.md §5.1).

ALTER TABLE "Documento"
  ADD COLUMN IF NOT EXISTS "documento_relleno_url" TEXT;
