-- 20260701120000_campos_personalizados
--
-- Campos personalizados de la ficha del empleado. El OWNER define campos
-- extra (por tenant, aplican a todos los empleados) y guarda un valor por
-- empleado. Idempotente (lazy migrations).

CREATE TABLE IF NOT EXISTS "CampoPersonalizado" (
  "id"        TEXT NOT NULL,
  "clave"     TEXT NOT NULL,
  "etiqueta"  TEXT NOT NULL,
  "tipo"      TEXT NOT NULL DEFAULT 'texto',
  "orden"     INTEGER NOT NULL DEFAULT 0,
  "activo"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampoPersonalizado_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CampoPersonalizado_clave_key"
  ON "CampoPersonalizado"("clave");
CREATE INDEX IF NOT EXISTS "CampoPersonalizado_activo_idx"
  ON "CampoPersonalizado"("activo");

CREATE TABLE IF NOT EXISTS "ValorCampoEmpleado" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "campoId"   TEXT NOT NULL,
  "valor"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ValorCampoEmpleado_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ValorCampoEmpleado_userId_campoId_key"
  ON "ValorCampoEmpleado"("userId", "campoId");
CREATE INDEX IF NOT EXISTS "ValorCampoEmpleado_campoId_idx"
  ON "ValorCampoEmpleado"("campoId");

DO $$
BEGIN
  ALTER TABLE "ValorCampoEmpleado"
    ADD CONSTRAINT "ValorCampoEmpleado_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ValorCampoEmpleado"
    ADD CONSTRAINT "ValorCampoEmpleado_campoId_fkey"
    FOREIGN KEY ("campoId") REFERENCES "CampoPersonalizado"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
