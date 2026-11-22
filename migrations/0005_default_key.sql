-- Key 类型：normal=用户自建可删 / default=注册自动生成、不可删除、仅供内部 Playground 使用
ALTER TABLE api_tokens ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal';
UPDATE api_tokens SET kind = 'default' WHERE name = 'Playground 默认密钥';
