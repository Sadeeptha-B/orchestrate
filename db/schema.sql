-- Whole-slice snapshot store for the D1 sync sidecar (see functions/api/state/*).
-- One row per persisted localStorage slice; last-write-wins on updated_at.
--
-- Single-user by design — no user_id. Apply idempotently:
--   npx wrangler d1 execute orchestrate-sync --remote --file db/schema.sql
--   npx wrangler d1 execute orchestrate-sync --local  --file db/schema.sql
CREATE TABLE IF NOT EXISTS slices (
    key            TEXT PRIMARY KEY,   -- 'plan' | 'settings' | 'history' | 'life'
    value          TEXT NOT NULL,      -- the exact JSON string the client persists to localStorage
    schema_version REAL NOT NULL,      -- SCHEMA_VERSION at push time
    updated_at     INTEGER NOT NULL    -- ms epoch of the client mutation (last-write-wins key)
);
