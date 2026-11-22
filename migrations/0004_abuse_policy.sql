-- 每分钟防滥用限速：按用户统计每分钟 Token 用量
CREATE TABLE IF NOT EXISTS rate_minute (
  subject TEXT NOT NULL,
  minute TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, minute)
);
CREATE INDEX IF NOT EXISTS idx_rate_minute_minute ON rate_minute(minute);
