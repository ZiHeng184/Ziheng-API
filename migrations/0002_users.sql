-- 用户体系、邀请码注册、邮箱验证码

ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE admin_users ADD COLUMN email TEXT;
ALTER TABLE admin_users ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;

ALTER TABLE api_tokens ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'register',
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email, purpose, created_at);

CREATE TABLE IF NOT EXISTS mail_logs (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
