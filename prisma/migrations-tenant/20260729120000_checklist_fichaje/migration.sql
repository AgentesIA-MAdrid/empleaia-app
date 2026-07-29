-- 20260729120000_checklist_fichaje
--
-- Ticket c4bc33d6: el cliente quiere que, antes de fichar, el empleado
-- confirme una serie de comprobaciones (stock y caja del compañero
-- anterior, estado de la tienda al entrar; ventas, stock y cierre de
-- caja al salir).
--
-- `ChecklistFichajeItem` es el catálogo editable por el OWNER (uno por
-- tipo ENTRADA/SALIDA) y `FichajeChecklist` guarda lo confirmado en cada
-- fichaje, con el enunciado en snapshot para que el histórico siga
-- siendo legible aunque luego se edite o borre el item.
--
-- El checklist solo se pide si `ConfiguracionEmpresa.checklist_fichaje_activo`
-- está activo (off por defecto: no cambia el comportamiento de ningún
-- tenant que no lo pida). Los 6 items del ticket se insertan como punto
-- de partida editable.
--
-- Idempotente (lazy migrations): IF NOT EXISTS + ON CONFLICT DO NOTHING.

ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN IF NOT EXISTS "checklist_fichaje_activo" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "ChecklistFichajeItem" (
  "id"        TEXT NOT NULL,
  "tipo"      "TipoFichaje" NOT NULL,
  "texto"     TEXT NOT NULL,
  "orden"     INTEGER NOT NULL DEFAULT 0,
  "activo"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChecklistFichajeItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChecklistFichajeItem_tipo_orden_idx"
  ON "ChecklistFichajeItem"("tipo", "orden");

CREATE TABLE IF NOT EXISTS "FichajeChecklist" (
  "id"        TEXT NOT NULL,
  "fichajeId" TEXT NOT NULL,
  "itemId"    TEXT,
  "texto"     TEXT NOT NULL,
  "orden"     INTEGER NOT NULL DEFAULT 0,
  "marcado"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FichajeChecklist_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FichajeChecklist_fichajeId_idx" ON "FichajeChecklist"("fichajeId");
CREATE INDEX IF NOT EXISTS "FichajeChecklist_itemId_idx" ON "FichajeChecklist"("itemId");

DO $$ BEGIN
  ALTER TABLE "FichajeChecklist"
    ADD CONSTRAINT "FichajeChecklist_fichajeId_fkey"
    FOREIGN KEY ("fichajeId") REFERENCES "Fichaje"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "FichajeChecklist"
    ADD CONSTRAINT "FichajeChecklist_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "ChecklistFichajeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Puntos de control por defecto (los del ticket). Ids fijos para que la
-- re-ejecución no duplique filas; el OWNER puede editarlos o borrarlos.
INSERT INTO "ChecklistFichajeItem" ("id", "tipo", "texto", "orden", "activo", "createdAt", "updatedAt")
VALUES
  ('chkfic_ent_stock',    'ENTRADA', 'He revisado el stock de mi compañero del turno anterior', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('chkfic_ent_caja',     'ENTRADA', 'El fondo de caja de mi compañero del turno anterior es correcto', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('chkfic_ent_limpieza', 'ENTRADA', 'La tienda está en perfecto estado de limpieza y orden', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('chkfic_sal_ventas',   'SALIDA',  'He registrado mis ventas', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('chkfic_sal_stock',    'SALIDA',  'He registrado el stock', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('chkfic_sal_caja',     'SALIDA',  'He hecho el cierre de caja', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
