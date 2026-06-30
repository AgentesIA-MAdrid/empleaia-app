-- Número correlativo global de tickets de feedback.
ALTER TABLE "master"."feedback_tickets" ADD COLUMN IF NOT EXISTS "numero" INTEGER;
CREATE SEQUENCE IF NOT EXISTS "master"."feedback_tickets_numero_seq";
-- Numera los existentes por orden de creación (solo los que aún no tienen número).
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM "master"."feedback_tickets" WHERE "numero" IS NULL
)
UPDATE "master"."feedback_tickets" t SET "numero" = o.rn FROM ordered o WHERE t.id = o.id;
-- Alinea la secuencia: si hay tickets, próximo = max+1; si no, próximo = 1.
SELECT setval(
  '"master"."feedback_tickets_numero_seq"',
  GREATEST(COALESCE((SELECT MAX("numero") FROM "master"."feedback_tickets"), 0), 1),
  (SELECT COUNT(*) > 0 FROM "master"."feedback_tickets")
);
ALTER TABLE "master"."feedback_tickets" ALTER COLUMN "numero" SET DEFAULT nextval('"master"."feedback_tickets_numero_seq"');
ALTER TABLE "master"."feedback_tickets" ALTER COLUMN "numero" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "feedback_tickets_numero_key" ON "master"."feedback_tickets" ("numero");
