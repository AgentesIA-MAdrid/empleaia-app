-- 20260608120000_tipos_turno_y_horas_contrato
--
-- 1. TipoTurno: catálogo de tipos de turno que cada cliente define
--    (Mañana, Tarde, Doble, M/T, Libre, rangos a medida…). Análogo a
--    TipoAusencia.
-- 2. Turno.tipoTurnoId (nullable): FK opcional al tipo de turno.
-- 3. User.horas_semanales_contrato (Decimal, nullable): horas semanales
--    contratadas por empleado (columna "HORAS A CONTRATO" del cuadrante).
--    Si NULL, se usa ConfiguracionEmpresa.horasSemanales.

CREATE TABLE IF NOT EXISTS "TipoTurno" (
  "id"          TEXT NOT NULL,
  "nombre"      TEXT NOT NULL,
  "abreviatura" TEXT NOT NULL DEFAULT '',
  "color"       TEXT NOT NULL DEFAULT '#6366f1',
  "horaInicio"  TEXT,
  "horaFin"     TEXT,
  "horas"       DECIMAL(5,2) NOT NULL DEFAULT 0,
  "esLibre"     BOOLEAN NOT NULL DEFAULT false,
  "orden"       INTEGER NOT NULL DEFAULT 0,
  "activo"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TipoTurno_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Turno"
  ADD COLUMN IF NOT EXISTS "tipoTurnoId" TEXT;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "horas_semanales_contrato" DECIMAL(5,2);

DO $$ BEGIN
  ALTER TABLE "Turno"
    ADD CONSTRAINT "Turno_tipoTurnoId_fkey"
    FOREIGN KEY ("tipoTurnoId") REFERENCES "TipoTurno"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Turno_tipoTurnoId_idx" ON "Turno"("tipoTurnoId");
