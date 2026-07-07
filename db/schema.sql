-- Whole-slice snapshot store for the D1 sync sidecar (see functions/api/state/*).
-- One row per user per persisted localStorage slice; last-write-wins on updated_at.
-- user_id is the Cloudflare Access identity (lowercased email) resolved by requireUser.
--
-- Apply idempotently:
--   npx wrangler d1 execute orchestrate-sync --remote --file db/schema.sql
--   npx wrangler d1 execute orchestrate-sync --local  --file db/schema.sql
--
-- Migrating a pre-multi-user database (single global rows, no user_id): see
-- db/migrate_add_user_id.sql (backfills existing rows to the owner's email).
CREATE TABLE IF NOT EXISTS slices (
    user_id        TEXT NOT NULL,      -- Access identity (email, lowercased)
    key            TEXT NOT NULL,      -- 'plan' | 'settings' | 'history' | 'life'
    value          TEXT NOT NULL,      -- the exact JSON string the client persists to localStorage
    schema_version REAL NOT NULL,      -- SCHEMA_VERSION at push time
    updated_at     INTEGER NOT NULL,   -- ms epoch of the client mutation (last-write-wins key)
    PRIMARY KEY (user_id, key)
);
