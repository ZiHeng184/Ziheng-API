export type Provider = {
  id: string; name: string; protocol: "openai" | "claude"; base_url: string; enabled: number; priority: number;
  timeout_ms: number; created_at: string; model_count: number; key_count: number;
};
export type Model = { id: string; provider_id: string; name: string; upstream_name: string; enabled: number; supports_tools: number; supports_vision: number;
  audience?: "admin" | "all" | "selected"; allowed_user_ids?: string; tos_confirmed?: number; max_output_tokens?: number };
export type ProviderKey = { id: string; provider_id: string; key_hint: string; enabled: number; cooldown_until?: string; last_used_at?: string; last_error?: string };
export type RouteEntry = { id?: string; provider_id: string; model_id: string; enabled?: number; provider_name?: string; model_name?: string; upstream_name?: string; position?: number };
export type Route = { id: string; name: string; description: string; enabled: number; entries: RouteEntry[] };
export type ApiToken = {
  id: string; name: string; prefix: string; enabled: number; expires_at?: string; allowed_models: string[]; allowed_ips: string[];
  request_limit?: number; token_limit?: number; concurrency_limit?: number; used_requests: number; used_tokens: number; active_requests: number; created_at: string; last_used_at?: string;
  kind?: "normal" | "default";
};
export type CatalogModel = {
  id: string; name: string; provider: string; protocol: string; upstreamName: string;
  supportsTools: boolean; supportsVision: boolean; audience: "admin" | "all" | "selected"; tosConfirmed: boolean;
  visible: boolean; status: "available" | "degraded" | "unavailable"; totalKeys: number; readyKeys: number; priority: number;
};
export type CatalogRoute = { name: string; description: string; targets: number };
export type Catalog = { models: CatalogModel[]; routes: CatalogRoute[] };
export type ErrorLog = { id: string; request_id: string; route_model: string; provider_name?: string; model_name?: string; token_name?: string; status?: number; message: string; attempts: number; created_at: string };
export type ToastItem = { id: number; type: "success" | "error"; message: string };
