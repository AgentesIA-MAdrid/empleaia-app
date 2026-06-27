-- Añade el estado terminal `desplegado` a los jobs de "Resolver con Claude".
-- Lo dispara el webhook de GitHub al mergear el PR del ticket (auto-resolución).
-- IF NOT EXISTS para idempotencia (re-deploy no falla). ADD VALUE no usa el
-- nuevo valor en la misma transacción, así que es seguro dentro del migrate.
ALTER TYPE "master"."FeedbackJobStatus" ADD VALUE IF NOT EXISTS 'desplegado';
