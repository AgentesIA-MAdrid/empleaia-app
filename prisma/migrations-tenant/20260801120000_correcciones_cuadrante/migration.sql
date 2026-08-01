-- 20260801120000_correcciones_cuadrante
--
-- Corregir el cuadrante desde el cuadro de discrepancias del informe
-- (ticket c1e94a7b).
--
-- En `Turno`:
--   corregido        el turno se ha tocado a mano al resolver una discrepancia.
--                    Se pinta en AMARILLO en el cuadrante.
--   no_realizado     estaba publicado y nadie fichó, y se ha confirmado. Sigue
--                    en el cuadrante —no se borra, para no perder de vista lo
--                    previsto— pero sus horas no cuentan en el informe de horas:
--                    salen aparte, en la hoja de incidencias.
--   nota_correccion  lo que decía el cuadrante antes, en texto.
--
-- `CorreccionCuadrante` es el historial: quién corrigió qué y cuándo. Guarda el
-- antes y el después EN TEXTO a propósito; el turno se puede volver a tocar o la
-- sede desaparecer, y un registro de auditoría tiene que seguir contando lo que
-- pasó.
--
-- Idempotente (se aplica a tenant_template y a cada tenant_<slug>).

ALTER TABLE "Turno" ADD COLUMN IF NOT EXISTS "corregido" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Turno" ADD COLUMN IF NOT EXISTS "no_realizado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Turno" ADD COLUMN IF NOT EXISTS "nota_correccion" TEXT;

CREATE INDEX IF NOT EXISTS "Turno_corregido_idx" ON "Turno"("corregido");

CREATE TABLE IF NOT EXISTS "CorreccionCuadrante" (
  "id"                TEXT NOT NULL,
  "turno_id"          TEXT,
  "user_id"           TEXT NOT NULL,
  "fecha"             DATE NOT NULL,
  "tipo"              TEXT NOT NULL,
  "antes"             TEXT NOT NULL,
  "despues"           TEXT NOT NULL,
  "corregido_por_id"  TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorreccionCuadrante_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CorreccionCuadrante_fecha_idx" ON "CorreccionCuadrante"("fecha");
CREATE INDEX IF NOT EXISTS "CorreccionCuadrante_user_id_idx" ON "CorreccionCuadrante"("user_id");

-- Las FK van con DO/EXCEPTION porque ADD CONSTRAINT no admite IF NOT EXISTS.
DO $$
BEGIN
  ALTER TABLE "CorreccionCuadrante"
    ADD CONSTRAINT "CorreccionCuadrante_turno_id_fkey"
    FOREIGN KEY ("turno_id") REFERENCES "Turno"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CorreccionCuadrante"
    ADD CONSTRAINT "CorreccionCuadrante_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CorreccionCuadrante"
    ADD CONSTRAINT "CorreccionCuadrante_corregido_por_id_fkey"
    FOREIGN KEY ("corregido_por_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
