-- Historial de correcciones de un arqueo (ticket 5a71fe28).
--
-- Hasta ahora un arqueo ya recogido no lo podía tocar nadie, ni administración:
-- si el importe estaba mal, se quedaba mal. Se habilita la corrección, y con
-- ella el registro que la app ya le promete al empleado ("solo un administrador
-- podrá corregirlos, y quedará registrado quién lo cambió y por qué").
CREATE TABLE IF NOT EXISTS "ArqueoCorreccion" (
  "id"                TEXT NOT NULL,
  "arqueoId"          TEXT NOT NULL,
  "declarado_antes"   DECIMAL(10,2) NOT NULL,
  "recogido_antes"    DECIMAL(10,2),
  "declarado_despues" DECIMAL(10,2) NOT NULL,
  "recogido_despues"  DECIMAL(10,2),
  "motivo"            TEXT NOT NULL,
  "corregido_por_id"  TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArqueoCorreccion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ArqueoCorreccion_arqueoId_createdAt_idx"
  ON "ArqueoCorreccion" ("arqueoId", "createdAt");

DO $$
BEGIN
  ALTER TABLE "ArqueoCorreccion" ADD CONSTRAINT "ArqueoCorreccion_arqueoId_fkey"
    FOREIGN KEY ("arqueoId") REFERENCES "Arqueo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ArqueoCorreccion" ADD CONSTRAINT "ArqueoCorreccion_corregido_por_id_fkey"
    FOREIGN KEY ("corregido_por_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
