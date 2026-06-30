-- 20260630140000_festivos_local_y_excepciones
--
-- Festivos por sede + excepciones por empleado.
--
-- 1) Festivo.tiendaId (TEXT, nullable): sede a la que aplica un festivo
--    "local". null = festivo "nacional" (aplica a toda la plantilla).
--    ON DELETE CASCADE: si se borra la sede, sus festivos locales se borran.
--
-- 2) FestivoExcepcion: la presencia de una fila (festivoId, userId) significa
--    que ese empleado trabaja ese día pese al festivo (se le "quita" para
--    asignar jornada / horas extra). Único por (festivoId, userId).

ALTER TABLE "Festivo" ADD COLUMN IF NOT EXISTS "tiendaId" TEXT;

ALTER TABLE "Festivo"
  ADD CONSTRAINT "Festivo_tiendaId_fkey"
  FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Festivo_tiendaId_idx" ON "Festivo"("tiendaId");

CREATE TABLE "FestivoExcepcion" (
    "id" TEXT NOT NULL,
    "festivoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FestivoExcepcion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FestivoExcepcion_festivoId_userId_key" ON "FestivoExcepcion"("festivoId", "userId");

CREATE INDEX "FestivoExcepcion_userId_idx" ON "FestivoExcepcion"("userId");

ALTER TABLE "FestivoExcepcion"
  ADD CONSTRAINT "FestivoExcepcion_festivoId_fkey"
  FOREIGN KEY ("festivoId") REFERENCES "Festivo"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FestivoExcepcion"
  ADD CONSTRAINT "FestivoExcepcion_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
