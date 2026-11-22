import { Hono } from "hono";
import type { AppEnv, Provider } from "./types";
import { bool, id, json, now, parseJson } from "./types";
import { all, one, run, setSetting, setting, policy } from "./db";
import { buildCatalog } from "./proxy";
import { createApiToken, decryptSecret, encryptSecret, hashPassword, maskSecret, sha256, verifyPassword } from "./crypto";
import { fail, ok, safeMessage } from "./http";

export const admin = new Hono<AppEnv>();

const providerSelect = `SELECT p.*, (SELECT COUNT(*) FROM models m WHERE m.provider_id = p.id) model_count,
  (SELECT COUNT(*) FROM provider_keys k WHERE k.provider_id = p.id AND k.enabled = 1) key_count FROM providers p`;

admin.get("/overview", async c => {
  const totals = await one<{ requests: number; errors: number; input_tokens: number; output_tokens: number }>(c.env.DB,
    "SELECT COALESCE(SUM(requests),0) requests, COALESCE(SUM(errors),0) errors, COALESCE(SUM(input_tokens),0) input_tokens, COALESCE(SUM(output_tokens),0) output_tokens FROM usage_daily");
  const today = await one<{ requests: number; errors: number }>(c.env.DB,
    "SELECT COALESCE(SUM(requests),0) requests, COALESCE(SUM(errors),0) errors FROM usage_daily WHERE day = date('now')");
  const counts = await one<{ providers: number; models: number; tokens: number }>(c.env.DB,
    `SELECT (SELECT COUNT(*) FROM providers WHERE enabled=1) providers,
     (SELECT COUNT(*) FROM models WHERE enabled=1) models,
     (SELECT COUNT(*) FROM api_tokens WHERE enabled=1) tokens`);
  const days = await all(c.env.DB, "SELECT * FROM usage_daily ORDER BY day DESC LIMIT 7");
  const providers = await all(c.env.DB, `SELECT p.id, p.name, p.protocol, p.enabled,
    (SELECT COUNT(*) FROM error_logs e WHERE e.provider_id=p.id) errors FROM providers p ORDER BY p.priority DESC`);
  const recentErrors = await all(c.env.DB, `SELECT e.*, p.name provider_name FROM error_logs e
    LEFT JOIN providers p ON p.id=e.provider_id ORDER BY e.created_at DESC LIMIT 5`);
  return ok(c, { totals, today, counts, days: days.reverse(), providers, recentErrors });
});

admin.get("/providers", async c => ok(c, await all(c.env.DB, `${providerSelect} ORDER BY p.priority DESC, p.created_at`)));

admin.post("/providers", async c => {
  const b = await c.req.json().catch(() => null);
  if (!b?.name || !b?.base_url || !["openai", "claude"].includes(b?.protocol)) return fail(c, "请完整填写渠道名称、协议和 Base URL", 422);
  if (b.base_url !== "mock://local") {
    try { new URL(b.base_url); } catch { return fail(c, "Base URL 格式不正确", 422); }
  }
  const providerId = id();
  await run(c.env.DB, `INSERT INTO providers(id,name,protocol,base_url,enabled,priority,timeout_ms) VALUES(?,?,?,?,?,?,?)`,
    [providerId, String(b.name).trim(), b.protocol, String(b.base_url).replace(/\/$/, ""), bool(b.enabled ?? true) ? 1 : 0, Number(b.priority || 0), Number(b.timeout_ms || 60000)]);
  if (b.api_key) {
    if (!c.env.KEY_ENCRYPTION_SECRET) return fail(c, "服务器未配置 KEY_ENCRYPTION_SECRET", 500);
    await run(c.env.DB, "INSERT INTO provider_keys(id,provider_id,encrypted_key,key_hint) VALUES(?,?,?,?)",
      [id(), providerId, await encryptSecret(b.api_key, c.env.KEY_ENCRYPTION_SECRET), maskSecret(b.api_key)]);
  }
  return ok(c, await one(c.env.DB, `${providerSelect} WHERE p.id=?`, [providerId]), 201);
});

admin.patch("/providers/:id", async c => {
  const b = await c.req.json().catch(() => ({})) as any;
  const fields: Record<string, string> = { name: "name", protocol: "protocol", base_url: "base_url", priority: "priority", timeout_ms: "timeout_ms" };
  const sets: string[] = []; const values: unknown[] = [];
  for (const [input, column] of Object.entries(fields)) if (b[input] !== undefined) { sets.push(`${column}=?`); values.push(b[input]); }
  if (b.enabled !== undefined) { sets.push("enabled=?"); values.push(bool(b.enabled) ? 1 : 0); }
  if (!sets.length) return fail(c, "没有可更新的字段");
  values.push(c.req.param("id"));
  await run(c.env.DB, `UPDATE providers SET ${sets.join(",")}, updated_at=datetime('now') WHERE id=?`, values);
  return ok(c, await one(c.env.DB, `${providerSelect} WHERE p.id=?`, [c.req.param("id")]));
});

admin.delete("/providers/:id", async c => { await run(c.env.DB, "DELETE FROM providers WHERE id=?", [c.req.param("id")]); return ok(c, null); });

admin.get("/providers/:id/keys", async c => ok(c, await all(c.env.DB,
  "SELECT id,provider_id,key_hint,enabled,cooldown_until,last_used_at,last_error,created_at FROM provider_keys WHERE provider_id=? ORDER BY created_at", [c.req.param("id")])));

admin.post("/providers/:id/keys", async c => {
  const b = await c.req.json<{ api_key?: string }>().catch(() => ({})) as any;
  if (!b.api_key?.trim()) return fail(c, "API Key 不能为空；匿名渠道无需添加 Key", 422);
  if (!c.env.KEY_ENCRYPTION_SECRET) return fail(c, "服务器未配置 KEY_ENCRYPTION_SECRET", 500);
  const keyId = id();
  await run(c.env.DB, "INSERT INTO provider_keys(id,provider_id,encrypted_key,key_hint) VALUES(?,?,?,?)",
    [keyId, c.req.param("id"), await encryptSecret(b.api_key.trim(), c.env.KEY_ENCRYPTION_SECRET), maskSecret(b.api_key.trim())]);
  return ok(c, { id: keyId }, 201);
});

admin.patch("/keys/:id", async c => {
  const b = await c.req.json().catch(() => ({})) as any;
  await run(c.env.DB, "UPDATE provider_keys SET enabled=COALESCE(?,enabled), cooldown_until=NULL, last_error=NULL WHERE id=?",
    [b.enabled === undefined ? null : bool(b.enabled) ? 1 : 0, c.req.param("id")]);
  return ok(c, null);
});
admin.delete("/keys/:id", async c => { await run(c.env.DB, "DELETE FROM provider_keys WHERE id=?", [c.req.param("id")]); return ok(c, null); });

admin.get("/providers/:id/models", async c => ok(c, await all(c.env.DB,
  "SELECT * FROM models WHERE provider_id=? ORDER BY name", [c.req.param("id")])));
admin.post("/providers/:id/models", async c => {
  const b = await c.req.json().catch(() => ({})) as any;
  if (!b.name?.trim()) return fail(c, "模型名称不能为空", 422);
  const modelId = id();
  const audience = ["admin", "all", "selected"].includes(b.audience) ? b.audience : "admin";
  const tos = bool(b.tos_confirmed) ? 1 : 0;
  if (audience === "all" && !tos) return fail(c, "开放给所有用户前，请先确认该上游服务条款允许中转", 422);
  const outputCap = b.max_output_tokens === undefined || b.max_output_tokens === null || b.max_output_tokens === "" ? null : Math.max(0, Number(b.max_output_tokens) || 0);
  try {
    await run(c.env.DB, `INSERT INTO models(id,provider_id,name,upstream_name,supports_tools,supports_vision,audience,allowed_user_ids,tos_confirmed,max_output_tokens) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [modelId, c.req.param("id"), b.name.trim(), b.upstream_name?.trim() || b.name.trim(),
        bool(b.supports_tools ?? true) ? 1 : 0, bool(b.supports_vision ?? true) ? 1 : 0,
        audience, json(Array.isArray(b.allowed_user_ids) ? b.allowed_user_ids : []), tos, outputCap]);
  } catch { return fail(c, "该渠道已存在同名模型", 409); }
  return ok(c, await one(c.env.DB, "SELECT * FROM models WHERE id=?", [modelId]), 201);
});
admin.patch("/models/:id", async c => {
  const b = await c.req.json().catch(() => ({})) as any;
  const modelId = c.req.param("id");
  const existing = await one<{ audience: string; tos_confirmed: number }>(c.env.DB, "SELECT audience,tos_confirmed FROM models WHERE id=?", [modelId]);
  const audience = b.audience !== undefined ? (["admin", "all", "selected"].includes(b.audience) ? b.audience : "admin") : existing?.audience;
  const tos = b.tos_confirmed !== undefined ? (bool(b.tos_confirmed) ? 1 : 0) : existing?.tos_confirmed;
  const outputCap = b.max_output_tokens === undefined || b.max_output_tokens === null || b.max_output_tokens === "" ? null : Math.max(0, Number(b.max_output_tokens) || 0);
  if (audience === "all" && !tos) return fail(c, "开放给所有用户前，请先确认该上游服务条款允许中转", 422);
  await run(c.env.DB, `UPDATE models SET name=COALESCE(?,name), upstream_name=COALESCE(?,upstream_name),
    enabled=COALESCE(?,enabled), supports_tools=COALESCE(?,supports_tools), supports_vision=COALESCE(?,supports_vision),
    audience=?, tos_confirmed=?, allowed_user_ids=COALESCE(?,allowed_user_ids),
    max_output_tokens=CASE WHEN ? THEN ? ELSE max_output_tokens END WHERE id=?`,
    [b.name ?? null, b.upstream_name ?? null, b.enabled === undefined ? null : bool(b.enabled) ? 1 : 0,
      b.supports_tools === undefined ? null : bool(b.supports_tools) ? 1 : 0, b.supports_vision === undefined ? null : bool(b.supports_vision) ? 1 : 0,
      audience ?? "admin", tos ?? 0, b.allowed_user_ids !== undefined ? json(b.allowed_user_ids) : null,
      b.max_output_tokens !== undefined ? 1 : 0, outputCap ?? null, modelId]);
  return ok(c, null);
});
admin.delete("/models/:id", async c => { await run(c.env.DB, "DELETE FROM models WHERE id=?", [c.req.param("id")]); return ok(c, null); });

admin.post("/providers/:id/discover", async c => {
  const provider = await one<Provider>(c.env.DB, "SELECT * FROM providers WHERE id=?", [c.req.param("id")]);
  if (!provider) return fail(c, "渠道不存在", 404);
  if (provider.base_url === "mock://local") return ok(c, ["ziheng-flash", "ziheng-pro", "ziheng-vision"]);
  try {
    const key = await one<{ encrypted_key: string }>(c.env.DB, "SELECT encrypted_key FROM provider_keys WHERE provider_id=? AND enabled=1 ORDER BY last_used_at LIMIT 1", [provider.id]);
    const headers: Record<string, string> = {};
    if (key) {
      const secret = await decryptSecret(key.encrypted_key, c.env.KEY_ENCRYPTION_SECRET || "");
      if (provider.protocol === "openai") headers.Authorization = `Bearer ${secret}`;
      else { headers["x-api-key"] = secret; headers["anthropic-version"] = "2023-06-01"; }
    }
    const root = provider.base_url.replace(/\/$/, "");
    const url = provider.protocol === "openai" ? `${root.replace(/\/v1$/, "")}/v1/models` : `${root.replace(/\/v1$/, "")}/v1/models`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return fail(c, `拉取失败：上游返回 ${response.status}`, 502);
    const data = await response.json<{ data?: { id: string }[]; models?: { name: string }[] }>();
    const names = data.data?.map(m => m.id) || data.models?.map(m => m.name.replace(/^models\//, "")) || [];
    return ok(c, names);
  } catch (error) { return fail(c, `拉取失败：${safeMessage(error)}`, 502); }
});

admin.post("/providers/:id/test", async c => {
  const provider = await one<Provider>(c.env.DB, "SELECT * FROM providers WHERE id=?", [c.req.param("id")]);
  if (!provider) return fail(c, "渠道不存在", 404);
  if (provider.base_url === "mock://local") return ok(c, { latency: 36, message: "匿名模拟渠道连接正常" });
  const model = await one<{ upstream_name: string }>(c.env.DB, "SELECT upstream_name FROM models WHERE provider_id=? AND enabled=1 LIMIT 1", [provider.id]);
  if (!model) return fail(c, "请先添加一个模型", 422);
  const started = Date.now();
  try {
    const key = await one<{ encrypted_key: string }>(c.env.DB, "SELECT encrypted_key FROM provider_keys WHERE provider_id=? AND enabled=1 ORDER BY last_used_at LIMIT 1", [provider.id]);
    const secret = key ? await decryptSecret(key.encrypted_key, c.env.KEY_ENCRYPTION_SECRET || "") : "";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (secret && provider.protocol === "openai") headers.Authorization = `Bearer ${secret}`;
    if (secret && provider.protocol === "claude") { headers["x-api-key"] = secret; headers["anthropic-version"] = "2023-06-01"; }
    const root = provider.base_url.replace(/\/$/, "").replace(/\/v1$/, "");
    const isClaude = provider.protocol === "claude";
    const response = await fetch(`${root}${isClaude ? "/v1/messages" : "/v1/chat/completions"}`, { method: "POST", headers,
      body: JSON.stringify(isClaude ? { model: model.upstream_name, max_tokens: 8, messages: [{ role: "user", content: "Ping" }] } : { model: model.upstream_name, max_tokens: 8, messages: [{ role: "user", content: "Ping" }] }), signal: AbortSignal.timeout(provider.timeout_ms) });
    if (!response.ok) return fail(c, `连接失败：HTTP ${response.status} ${(await response.text()).slice(0, 160)}`, 502);
    return ok(c, { latency: Date.now() - started, message: "渠道连接与模型调用正常" });
  } catch (error) { return fail(c, `连接失败：${safeMessage(error)}`, 502); }
});

admin.get("/routes", async c => {
  const routes = await all<{ id: string; name: string; description: string; enabled: number; created_at: string }>(c.env.DB, "SELECT * FROM routes ORDER BY created_at");
  const entries = await all<any>(c.env.DB, `SELECT e.*, p.name provider_name, m.name model_name, m.upstream_name FROM route_entries e
    JOIN providers p ON p.id=e.provider_id JOIN models m ON m.id=e.model_id ORDER BY e.route_id,e.position`);
  return ok(c, routes.map(route => ({ ...route, entries: entries.filter((entry: { route_id: string }) => entry.route_id === route.id) })));
});

admin.post("/routes", async c => {
  const b = await c.req.json().catch(() => ({})) as any;
  if (!b.name?.trim() || !/^[a-zA-Z0-9_.-]+$/.test(b.name)) return fail(c, "路由名只能包含字母、数字、点、下划线和连字符", 422);
  const routeId = id();
  try { await run(c.env.DB, "INSERT INTO routes(id,name,description) VALUES(?,?,?)", [routeId, b.name.trim(), b.description || ""]); }
  catch { return fail(c, "路由名称已存在", 409); }
  return ok(c, { id: routeId }, 201);
});
admin.patch("/routes/:id", async c => {
  const b = await c.req.json().catch(() => ({})) as any;
  const routeId = c.req.param("id");
  await run(c.env.DB, "UPDATE routes SET name=COALESCE(?,name),description=COALESCE(?,description),enabled=COALESCE(?,enabled),updated_at=datetime('now') WHERE id=?",
    [b.name ?? null, b.description ?? null, b.enabled === undefined ? null : bool(b.enabled) ? 1 : 0, routeId]);
  if (Array.isArray(b.entries)) {
    await run(c.env.DB, "DELETE FROM route_entries WHERE route_id=?", [routeId]);
    for (let index = 0; index < b.entries.length; index++) {
      const entry = b.entries[index];
      await run(c.env.DB, "INSERT INTO route_entries(id,route_id,position,provider_id,model_id,enabled) VALUES(?,?,?,?,?,?)",
        [id(), routeId, index, entry.provider_id, entry.model_id, bool(entry.enabled ?? true) ? 1 : 0]);
    }
  }
  return ok(c, null);
});
admin.delete("/routes/:id", async c => { await run(c.env.DB, "DELETE FROM routes WHERE id=?", [c.req.param("id")]); return ok(c, null); });

admin.get("/tokens", async c => {
  const tokens = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM api_tokens ORDER BY created_at DESC");
  return ok(c, tokens.map(token => ({ ...token, key_hash: undefined, allowed_models: parseJson(token.allowed_models as string, []), allowed_ips: parseJson(token.allowed_ips as string, []) })));
});
admin.post("/tokens", async c => {
  const b = await c.req.json().catch(() => ({})) as any;
  if (!b.name?.trim()) return fail(c, "请输入 Key 名称", 422);
  const actor = c.get("user");
  const raw = createApiToken(); const tokenId = id();
  await run(c.env.DB, `INSERT INTO api_tokens(id,name,key_hash,prefix,expires_at,allowed_models,allowed_ips,request_limit,token_limit,concurrency_limit,user_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [tokenId, b.name.trim(), await sha256(raw), `${raw.slice(0, 12)}…${raw.slice(-4)}`,
    b.expires_at || null, json(b.allowed_models?.length ? b.allowed_models : ["*"]), json(b.allowed_ips || []),
    b.request_limit || null, b.token_limit || null, b.concurrency_limit || null, actor?.id || null]);
  return ok(c, { id: tokenId, token: raw }, 201);
});
admin.patch("/tokens/:id", async c => {
  const b = await c.req.json().catch(() => ({})) as any;
  const sets: string[] = []; const values: unknown[] = [];
  const fields: Record<string, string> = { name: "name", expires_at: "expires_at", request_limit: "request_limit", token_limit: "token_limit", concurrency_limit: "concurrency_limit" };
  for (const [input, column] of Object.entries(fields)) if (b[input] !== undefined) { sets.push(`${column}=?`); values.push(b[input] || null); }
  if (b.enabled !== undefined) { sets.push("enabled=?"); values.push(bool(b.enabled) ? 1 : 0); }
  if (b.allowed_models !== undefined) { sets.push("allowed_models=?"); values.push(json(b.allowed_models)); }
  if (b.allowed_ips !== undefined) { sets.push("allowed_ips=?"); values.push(json(b.allowed_ips)); }
  if (sets.length) { values.push(c.req.param("id")); await run(c.env.DB, `UPDATE api_tokens SET ${sets.join(",")} WHERE id=?`, values); }
  return ok(c, null);
});
admin.post("/tokens/:id/reset", async c => { await run(c.env.DB, "UPDATE api_tokens SET used_requests=0,used_tokens=0 WHERE id=?", [c.req.param("id")]); return ok(c, null); });
admin.delete("/tokens/:id", async c => { await run(c.env.DB, "DELETE FROM api_tokens WHERE id=?", [c.req.param("id")]); return ok(c, null); });

admin.get("/errors", async c => {
  const limit = Math.min(Number(c.req.query("limit") || 100), 200);
  const errors = await all(c.env.DB, `SELECT e.*,p.name provider_name,m.name model_name,t.name token_name FROM error_logs e
    LEFT JOIN providers p ON p.id=e.provider_id LEFT JOIN models m ON m.id=e.model_id LEFT JOIN api_tokens t ON t.id=e.token_id
    ORDER BY e.created_at DESC LIMIT ?`, [limit]);
  return ok(c, errors);
});
admin.delete("/errors", async c => { await run(c.env.DB, "DELETE FROM error_logs"); return ok(c, null); });

admin.get("/settings", async c => {
  const retry = await setting(c.env.DB, "retry", { maxAttempts: 6, timeoutMs: 60000, retryStatuses: [408, 429, 500, 502, 503, 504], cooldownSeconds: 60 });
  const pol = await policy(c.env.DB);
  return ok(c, { retry, policy: pol, devLogin: c.env.ALLOW_DEV_LOGIN === "true", demoMode: c.env.DEMO_MODE === "true", siteName: "Ziheng API" });
});
admin.patch("/settings", async c => {
  const b = await c.req.json().catch(() => ({})) as any;
  if (b.retry) {
    const retry = { maxAttempts: Math.max(1, Math.min(Number(b.retry.maxAttempts) || 6, 20)),
      timeoutMs: Math.max(1000, Math.min(Number(b.retry.timeoutMs) || 60000, 300000)),
      retryStatuses: Array.isArray(b.retry.retryStatuses) ? b.retry.retryStatuses.map(Number).filter(Boolean) : [408,429,500,502,503,504],
      cooldownSeconds: Math.max(1, Number(b.retry.cooldownSeconds) || 60) };
    await setSetting(c.env.DB, "retry", retry);
  }
  if (b.policy) {
    const current = await policy(c.env.DB);
    const num = (v: unknown, fallback: number, min: number, max: number) => v === undefined || v === null || v === "" ? fallback : Math.max(min, Math.min(Number(v) || fallback, max));
    const nextPolicy = {
      monthlyRequestLimit: num(b.policy.monthlyRequestLimit, current.monthlyRequestLimit, 0, 100000),
      monthlyTokenLimit: num(b.policy.monthlyTokenLimit, current.monthlyTokenLimit, 0, 100000000),
      perMinuteTokens: num(b.policy.perMinuteTokens, current.perMinuteTokens, 100, 10000000),
      abuseEnabled: b.policy.abuseEnabled === undefined ? current.abuseEnabled : !!b.policy.abuseEnabled,
      maxOutputTokens: num(b.policy.maxOutputTokens, current.maxOutputTokens, 0, 10000000)
    };
    await setSetting(c.env.DB, "policy", nextPolicy);
  }
  return ok(c, null);
});
admin.get("/catalog", async c => ok(c, await buildCatalog(c.env.DB, (c.get("user") as any)?.id)));
admin.post("/password", async c => {
  const b = await c.req.json<{ current?: string; password?: string }>().catch(() => ({})) as any;
  if (!b.current || !b.password || b.password.length < 12) return fail(c, "新密码至少需要 12 个字符", 422);
  const user = await one<{ id: string; password_hash: string; password_salt: string }>(c.env.DB, "SELECT * FROM admin_users LIMIT 1");
  if (!user || !await verifyPassword(b.current, user.password_salt, user.password_hash)) return fail(c, "当前密码不正确", 403);
  const { salt, hash } = await hashPassword(b.password);
  await run(c.env.DB, "UPDATE admin_users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?", [hash, salt, now(), user.id]);
  await run(c.env.DB, "DELETE FROM sessions WHERE user_id=?", [user.id]);
  return ok(c, null);
});
