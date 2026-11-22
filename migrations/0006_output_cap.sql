-- 模型级输出 Token 上限（NULL 表示沿用全局策略 maxOutputTokens）
-- 用于钳制客户端传入的 max_tokens，避免超过上游模型的 max_model_len 而返回 400
ALTER TABLE models ADD COLUMN max_output_tokens INTEGER;
