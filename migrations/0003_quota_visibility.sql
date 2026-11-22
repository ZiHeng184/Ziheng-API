-- 普通用户每月免费额度（NULL 表示不限；管理员默认不限）
ALTER TABLE admin_users ADD COLUMN monthly_request_limit INTEGER;
ALTER TABLE admin_users ADD COLUMN monthly_token_limit INTEGER;

-- 模型可见范围：admin=仅管理员 / all=所有用户 / selected=指定用户
-- tos_confirmed=1 表示管理员已确认该上游服务条款允许中转，audience=all 时必须为 1
ALTER TABLE models ADD COLUMN audience TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE models ADD COLUMN allowed_user_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE models ADD COLUMN tos_confirmed INTEGER NOT NULL DEFAULT 0;

-- 用户每月用量统计
CREATE TABLE IF NOT EXISTS user_usage_monthly (
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
CREATE INDEX IF NOT EXISTS idx_user_usage_monthly ON user_usage_monthly(user_id, month);
