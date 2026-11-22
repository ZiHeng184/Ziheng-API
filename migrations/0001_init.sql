PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK(protocol IN ('openai', 'claude')),
  base_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  encrypted_key TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  cooldown_until TEXT,
  last_used_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON provider_keys(provider_id, enabled);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  upstream_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  supports_tools INTEGER NOT NULL DEFAULT 1,
  supports_vision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider_id, name)
);
CREATE INDEX IF NOT EXISTS idx_models_name ON models(name, enabled);

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS route_entries (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(route_id, position)
);
CREATE INDEX IF NOT EXISTS idx_route_entries_order ON route_entries(route_id, position);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  allowed_models TEXT NOT NULL DEFAULT '["*"]',
  allowed_ips TEXT NOT NULL DEFAULT '[]',
  request_limit INTEGER,
  token_limit INTEGER,
  concurrency_limit INTEGER,
  used_requests INTEGER NOT NULL DEFAULT 0,
  used_tokens INTEGER NOT NULL DEFAULT 0,
  active_requests INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS error_logs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  route_model TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  token_id TEXT,
  status INTEGER,
  message TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
