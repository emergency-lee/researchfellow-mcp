-- Telemetry storage (funnel-only usage stats; see web/privacy.html for the
-- public notice). Namespaced with telemetry_ so future billing tables
-- (api_keys, usage_events — billing-launch-runbook) never collide.
--
-- Provision: create a Neon project, then run this file once:
--   psql "$DATABASE_URL" -f migrations/001_telemetry.sql

CREATE TABLE IF NOT EXISTS telemetry_tokens (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash     TEXT NOT NULL UNIQUE,        -- sha256(token) hex; plaintext is never stored
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  plugin_version TEXT,
  consent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS telemetry_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash     TEXT NOT NULL REFERENCES telemetry_tokens(token_hash),
  project_hash   TEXT NOT NULL CHECK (project_hash ~ '^[0-9a-f]{64}$'),
  event          TEXT NOT NULL CHECK (event IN
                   ('project_created', 'entry_point_selected', 'step_entered',
                    'step_completed', 'gate_approved', 'gate_rejected',
                    'gate_changes_requested', 'session_resumed')),
  step           SMALLINT CHECK (step BETWEEN 1 AND 13),
  entry_point    TEXT CHECK (entry_point IN ('S1', 'S2', 'S3', 'S4', 'S5')),
  plugin_version TEXT,
  schema_version SMALLINT NOT NULL DEFAULT 1,
  client_ts      TIMESTAMPTZ NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_funnel
  ON telemetry_events (entry_point, step, event);
CREATE INDEX IF NOT EXISTS idx_telemetry_events_token_time
  ON telemetry_events (token_hash, client_ts);
