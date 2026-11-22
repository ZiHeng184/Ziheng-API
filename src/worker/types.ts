export type Bindings = {
  DB: D1Database;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  KEY_ENCRYPTION_SECRET?: string;
  ALLOW_DEV_LOGIN?: string;
  DEMO_MODE?: string;
  APP_ORIGIN?: string;
  MAIL_PROVIDER?: string;
  MAIL_API_KEY?: string;
  MAIL_FROM?: string;
  MAIL_FROM_NAME?: string;
  MAIL_SMTP_HOST?: string;
  MAIL_SMTP_PORT?: string;
  MAIL_SMTP_SECURITY?: string;
  MAIL_DEV_ECHO?: string;
};

export type SessionUser = { id: string; username: string; role: string; email: string | null; expires_at: string };

export type AppEnv = { Bindings: Bindings; Variables: { requestId: string; user?: SessionUser } };

export type Provider = {
  id: string;
  name: string;
  protocol: "openai" | "claude";
  base_url: string;
  enabled: number;
  priority: number;
  timeout_ms: number;
  created_at: string;
  updated_at: string;
};

export type ProviderKey = {
  id: string;
  provider_id: string;
  encrypted_key: string;
  key_hint: string;
  enabled: number;
  cooldown_until: string | null;
  last_used_at: string | null;
  last_error: string | null;
};

export type Model = {
  id: string;
  provider_id: string;
  name: string;
  upstream_name: string;
  enabled: number;
  supports_tools: number;
  supports_vision: number;
  audience?: "admin" | "all" | "selected";
  allowed_user_ids?: string;
  tos_confirmed?: number;
  max_output_tokens?: number;
};

export type ApiToken = {
  id: string;
  name: string;
  key_hash: string;
  prefix: string;
  enabled: number;
  expires_at: string | null;
  allowed_models: string;
  allowed_ips: string;
  request_limit: number | null;
  token_limit: number | null;
  concurrency_limit: number | null;
  used_requests: number;
  used_tokens: number;
  active_requests: number;
  user_id?: string | null;
  kind?: "normal" | "default";
  created_at: string;
  last_used_at: string | null;
};

export type RouteTarget = {
  entry_id?: string;
  provider: Provider;
  model: Model;
};

export type Usage = { input: number; output: number };

export const json = (value: unknown) => JSON.stringify(value);
export const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const bool = (value: unknown) => value === true || value === 1 || value === "1";
