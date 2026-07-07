-- One-time migration: single-user slices → per-user slices (plan: multi-user auth, Phase A3).
-- Rebuilds the table with a (user_id, key) primary key and backfills existing rows to the owner.
--
-- IMPORTANT: replace __OWNER_EMAIL__ with the owner's Google account email (lowercase) first, e.g.:
--   (Get-Content db/migrate_add_user_id.sql) -replace '__OWNER_EMAIL__','you@gmail.com' |
--       npx wrangler d1 execute orchestrate-sync --remote --file -
-- or edit a scratch copy and run:
--   npx wrangler d1 execute orchestrate-sync --remote --file db/migrate_add_user_id.sql
--   npx wrangler d1 execute orchestrate-sync --local  --file db/migrate_add_user_id.sql
CREATE TABLE slices_v2 (
    user_id        TEXT NOT NULL,
    key            TEXT NOT NULL,
    value          TEXT NOT NULL,
    schema_version REAL NOT NULL,
    updated_at     INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
);
INSERT INTO slices_v2 (user_id, key, value, schema_version, updated_at)
    SELECT '__OWNER_EMAIL__', key, value, schema_version, updated_at FROM slices;
DROP TABLE slices;
ALTER TABLE slices_v2 RENAME TO slices;
