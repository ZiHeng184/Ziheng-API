import { Hono } from "hono";
import type { Context } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv, ApiToken, Model, Provider, ProviderKey, RouteTarget, Usage } from "../types";
import { id, now, parseJson } from "../types";
import { all, one, run, recordUsage, recordUserUsage, setting, policy, minuteUsage, recordMinuteUsage, minuteKey } from "../db";
import { decryptSecret, sha256 } from "../crypto";
import { clientIp, openAiError } from "../http";
import { claudeStreamToOpenAi, claudeToOpenAi, openAiToClaude } from "./converters";
import { mockChat } from "./mock";

export const proxy = new Hono<AppEnv>();
type RetrySettings = { maxAttempts: number; timeoutMs: number; retryStatuses: number[]; cooldownSeconds: number };
const defaultRetry: RetrySettings = { maxAttempts: 6, timeoutMs: 60000, retryStatuses: [408, 409, 425, 429, 500, 502, 503, 504], cooldownSeconds: 60 };

function ipAllowed(ip: string, rules: string[]) {
  if (!rules.length) return true;
  return rules.some(rule => {
    if (rule === ip) return true;
    const [network, prefixText] = rule.split("/");
    const prefix = Number(prefixText);
    if (!prefixText || !/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(network) || prefix < 0 || prefix > 32) return false;
    const toInt = (value: string) => value.split(".").reduce((sum, part) => ((sum << 8) | Number(part)) >>> 0, 0);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (toInt(ip) & mask) === (toInt(network) & mask);
  });
}

async function authenticate(c: Context<AppEnv>): Promise<{ token?: ApiToken; response?: Response }> {
  const authorization = c.req.header("authorization") || "";
  const compatKey = c.req.header("x-ziheng-api-key") || c.req.header("x-api-key") || c.req.query("api_key") || "";
  const raw = compatKey.trim() || (authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "");
  if (!raw) return { response: openAiError("缺少 API Key，请使用 Authorization: Bearer <key>；若经网关代理，也可使用 x-ziheng-api-key", 401, "authentication_error") };
  const token = await one<ApiToken>(c.env.DB, "SELECT * FROM api_tokens WHERE key_hash=?", [await sha256(raw)]);
  if (!token || !token.enabled) return { response: openAiError("API Key 无效或已停用", 401, "authentication_error") };
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) return { response: openAiError("API Key 已过期", 401, "authentication_error") };
  if (!ipAllowed(clientIp(c), parseJson<string[]>(token.allowed_ips, []))) return { response: openAiError("当前 IP 不在此 Key 的白名单内", 403, "permission_error") };
  return { token };
}

/** 判断某个模型对当前调用者是否可见。管理员 Key（user_id 为空或角色 admin）不受限制。 */
export async function modelVisible(db: D1Database, model: Model, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return true; // 管理员直接创建的 Key / 向后兼容
  const user = await one<{ role: string }>(db, "SELECT role FROM admin_users WHERE id=?", [userId]);
  if (!user || user.role === "admin") return true;
  const audience = model.audience || "admin";
  if (audience === "all") return model.tos_confirmed === 1;
  if (audience === "selected") {
    const ids = parseJson<string[]>(model.allowed_user_ids, []);
    return ids.includes(userId);
  }
  return false;
}

/** 检查用户每月免费额度。返回 null 表示通过，否则返回错误信息。 */
async function monthlyQuota(db: D1Database, token: ApiToken): Promise<string | null> {
  if (!token.user_id) return null;
  const user = await one<{ role: string; monthly_request_limit: number | null; monthly_token_limit: number | null }>(db,
    "SELECT role,monthly_request_limit,monthly_token_limit FROM admin_users WHERE id=?", [token.user_id]);
  if (!user || user.role === "admin") return null;
  if (user.monthly_request_limit === null && user.monthly_token_limit === null) return null;
  const month = new Date().toISOString().slice(0, 7);
  const usage = await one<{ requests: number; input_tokens: number; output_tokens: number }>(db,
    "SELECT requests,input_tokens,output_tokens FROM user_usage_monthly WHERE user_id=? AND month=?", [token.user_id, month]);
  const requests = usage?.requests || 0;
  const tokens = (usage?.input_tokens || 0) + (usage?.output_tokens || 0);
  if (user.monthly_request_limit !== null && requests >= user.monthly_request_limit) return "本月免费请求额度已用尽";
  if (user.monthly_token_limit !== null && tokens >= user.monthly_token_limit) return "本月免费 Token 额度已用尽";
  return null;
}

async function acquire(token: ApiToken, env: AppEnv["Bindings"]) {
  if (token.request_limit !== null && token.used_requests >= token.request_limit) return { ok: false, message: "API Key 的请求次数额度已用尽" };
  if (token.token_limit !== null && token.used_tokens >= token.token_limit) return { ok: false, message: "API Key 的 Token 额度已用尽" };
  const quotaError = await monthlyQuota(env.DB, token);
  if (quotaError) return { ok: false, message: quotaError };
  // 每分钟防滥用：仅对普通用户（关联 user_id）按分钟累计 Token 限流，管理员 Key 不受限
  if (token.user_id) {
    const user = await one<{ role: string }>(env.DB, "SELECT role FROM admin_users WHERE id=?", [token.user_id]);
    if (user && user.role !== "admin") {
      const pol = await policy(env.DB);
      if (pol.abuseEnabled && await minuteUsage(env.DB, token.user_id, minuteKey()) >= pol.perMinuteTokens) {
        return { ok: false, message: "请求过于频繁：本分钟用量已达上限，请稍后再试" };
      }
    }
  }
  const result = await run(env.DB, `UPDATE api_tokens SET active_requests=active_requests+1,used_requests=used_requests+1,last_used_at=? WHERE id=?
    AND (concurrency_limit IS NULL OR active_requests < concurrency_limit)
    AND (request_limit IS NULL OR used_requests < request_limit)
    AND (token_limit IS NULL OR used_tokens < token_limit)`, [now(), token.id]);
  if (!result.meta.changes) return { ok: false, message: "API Key 已达到并发或额度上限" };
  return { ok: true };
}

async function finishToken(env: AppEnv["Bindings"], token: ApiToken, usage: Usage, error = false) {
  const total = usage.input + usage.output;
  await run(env.DB, `UPDATE api_tokens SET active_requests=MAX(0,active_requests-1),used_tokens=used_tokens+? WHERE id=?`,
    [total, token.id]);
  if (token.user_id) {
    await recordUserUsage(env.DB, token.user_id, usage.input, usage.output, error);
    await recordMinuteUsage(env.DB, token.user_id, minuteKey(), total);
  }
}

proxy.get("/models", async c => {
  const auth = await authenticate(c); if (auth.response || !auth.token) return auth.response!;
  const userId = auth.token.user_id;
  const allModels = await all<Model & { name: string }>(c.env.DB, "SELECT * FROM models WHERE enabled=1 ORDER BY name");
  const visible: (Model & { name: string })[] = [];
  for (const model of allModels) if (await modelVisible(c.env.DB, model, userId)) visible.push(model);
  const models = [...new Set(visible.map(item => item.name))];
  const routes = await all<{ name: string }>(c.env.DB, "SELECT name FROM routes WHERE enabled=1 ORDER BY name");
  return c.json({ object: "list", data: [...routes.map(r => r.name), ...models].map(name => ({ id: name, object: "model", created: 0, owned_by: "ziheng-api" })) });
});

/** 模型广场数据：模型能力、可见性、渠道健康度（供后台与普通用户模型页使用） */
export async function buildCatalog(db: D1Database, viewerId: string | null | undefined) {
  const rows = await all<any>(db, `SELECT m.*, p.name provider_name, p.protocol, p.base_url, p.enabled provider_enabled, p.priority,
    (SELECT COUNT(*) FROM provider_keys k WHERE k.provider_id=p.id AND k.enabled=1) total_keys,
    (SELECT COUNT(*) FROM provider_keys k WHERE k.provider_id=p.id AND k.enabled=1 AND (k.cooldown_until IS NULL OR k.cooldown_until<?)) ready_keys
    FROM models m JOIN providers p ON p.id=m.provider_id ORDER BY m.name`, [now()]);
  const models: Record<string, unknown>[] = [];
  for (const r of rows) {
    const visible = await modelVisible(db, r as Model, viewerId);
    let status = "available";
    if (!r.provider_enabled || !r.enabled) status = "unavailable";
    else if (r.total_keys > 0 && r.ready_keys === 0) status = "degraded";
    models.push({
      id: r.id, name: r.name, provider: r.provider_name, protocol: r.protocol, upstreamName: r.upstream_name,
      supportsTools: !!r.supports_tools, supportsVision: !!r.supports_vision,
      audience: r.audience || "admin", tosConfirmed: !!r.tos_confirmed, visible: !!visible,
      status, totalKeys: r.total_keys, readyKeys: r.ready_keys, priority: r.priority
    });
  }
  const routes = await all<any>(db, `SELECT r.name, r.description,
    (SELECT COUNT(*) FROM route_entries e JOIN providers p ON p.id=e.provider_id JOIN models m ON m.id=e.model_id
      WHERE e.route_id=r.id AND e.enabled=1 AND p.enabled=1 AND m.enabled=1) targets
    FROM routes r WHERE r.enabled=1 ORDER BY r.name`);
  return { models, routes };
}

async function routeTargets(db: D1Database, requested: string): Promise<{ targets: RouteTarget[]; isRoute: boolean }> {
  // 路由名大小写不敏感：auto / Auto / AUTO 均可命中
  const route = await one<{ id: string }>(db, "SELECT id FROM routes WHERE lower(name)=lower(?) AND enabled=1", [requested]);
  if (route) {
    const targets = await all<any>(db, `SELECT e.id entry_id,p.id,p.name,p.protocol,p.base_url,p.enabled,p.priority,p.timeout_ms,p.created_at,p.updated_at,
      m.id model_id,m.name model_name,m.upstream_name,m.enabled model_enabled,m.supports_tools,m.supports_vision,m.provider_id,
      m.audience,m.allowed_user_ids,m.tos_confirmed,m.max_output_tokens
      FROM route_entries e JOIN providers p ON p.id=e.provider_id JOIN models m ON m.id=e.model_id
      WHERE e.route_id=? AND e.enabled=1 AND p.enabled=1 AND m.enabled=1 ORDER BY e.position`, [route.id]);
    return { targets: targets.map(row => ({ entry_id: row.entry_id,
      provider: { id: row.id, name: row.name, protocol: row.protocol, base_url: row.base_url, enabled: row.enabled, priority: row.priority, timeout_ms: row.timeout_ms, created_at: "", updated_at: "" },
      model: { id: row.model_id, provider_id: row.provider_id, name: row.model_name, upstream_name: row.upstream_name, enabled: row.model_enabled, supports_tools: row.supports_tools, supports_vision: row.supports_vision, audience: row.audience, allowed_user_ids: row.allowed_user_ids, tos_confirmed: row.tos_confirmed, max_output_tokens: row.max_output_tokens } })), isRoute: true };
  }
  const rows = await all<any>(db, `SELECT p.id,p.name,p.protocol,p.base_url,p.enabled,p.priority,p.timeout_ms,
    m.id model_id,m.name model_name,m.upstream_name,m.enabled model_enabled,m.supports_tools,m.supports_vision,m.provider_id,
    m.audience,m.allowed_user_ids,m.tos_confirmed,m.max_output_tokens
    FROM models m JOIN providers p ON p.id=m.provider_id WHERE m.name=? AND m.enabled=1 AND p.enabled=1 ORDER BY p.priority DESC,p.created_at`, [requested]);
  return { targets: rows.map(row => ({ provider: { id: row.id, name: row.name, protocol: row.protocol, base_url: row.base_url, enabled: row.enabled, priority: row.priority, timeout_ms: row.timeout_ms, created_at: "", updated_at: "" },
    model: { id: row.model_id, provider_id: row.provider_id, name: row.model_name, upstream_name: row.upstream_name, enabled: row.model_enabled, supports_tools: row.supports_tools, supports_vision: row.supports_vision, audience: row.audience, allowed_user_ids: row.allowed_user_ids, tos_confirmed: row.tos_confirmed, max_output_tokens: row.max_output_tokens } })), isRoute: false };
}

/**
 * 转发前钳制输出类参数，避免客户端传过大的 max_tokens 触发上游 max_model_len 400。
 * 上限优先级：模型级 max_output_tokens > 全局 maxOutputTokens > 0（不钳制）。
 * 同时兼容 max_tokens / max_completion_tokens / max_new_tokens 三种写法。
 */
function clampOutputTokens(body: Record<string, unknown>, cap: number): Record<string, unknown> {
  if (!cap || cap <= 0) return body;
  const fields = ["max_tokens", "max_completion_tokens", "max_new_tokens"];
  let clamped = false;
  const next = { ...body };
  for (const field of fields) {
    const value = next[field];
    if (typeof value === "number" && Number.isFinite(value) && value > cap) {
      next[field] = cap;
      clamped = true;
    }
  }
  // 若客户端只给了一种写法，同步补齐另外两种，确保不同上游/协议都能识别被钳制后的上限
  if (clamped && !("max_tokens" in next) && !("max_completion_tokens" in next)) next.max_tokens = cap;
  return next;
}

async function dispatch(env: AppEnv["Bindings"], target: RouteTarget, key: string, body: Record<string, unknown>, outputCap: number) {
  const { provider, model } = target;
  // 模型级上限优先，否则用全局；0 表示不钳制
  const cap = model.max_output_tokens && model.max_output_tokens > 0 ? model.max_output_tokens : outputCap;
  body = clampOutputTokens(body, cap);
  if (provider.base_url === "mock://local") return mockChat(body, model.upstream_name);
  const root = provider.base_url.replace(/\/$/, "");
  // 不同上游的 OpenAI 兼容根路径：标准 /v1、KILO/OpenRouter 风格 /api/openrouter（无 v1）
  const openAiRoot = /\/(v1|openrouter)$/.test(root) ? root : `${root}/v1`;
  const headers: Record<string, string> = { "content-type": "application/json", accept: body.stream ? "text/event-stream" : "application/json" };
  let upstreamBody: Record<string, unknown>; let url: string;
  if (provider.protocol === "claude") {
    if (key) { headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01"; }
    upstreamBody = openAiToClaude(body, model.upstream_name); url = `${root.replace(/\/v1$/, "")}/v1/messages`;
  } else {
    if (key) headers.Authorization = `Bearer ${key}`;
    upstreamBody = { ...body, model: model.upstream_name };
    if (body.stream) upstreamBody.stream_options = { ...(body.stream_options as object || {}), include_usage: true };
    url = `${openAiRoot}/chat/completions`;
  }
  return fetch(url, { method: "POST", headers, body: JSON.stringify(upstreamBody), signal: AbortSignal.timeout(provider.timeout_ms) });
}

function trackedStream(stream: ReadableStream<Uint8Array>, done: (usage: Usage) => Promise<void>) {
  const reader = stream.getReader(); const decoder = new TextDecoder(); const encoder = new TextEncoder();
  let buffer = ""; let usage: Usage = { input: 0, output: 0 }; let finished = false;
  const complete = async () => { if (!finished) { finished = true; await done(usage); } };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: end, value } = await reader.read();
        if (end) { await complete(); controller.close(); return; }
        controller.enqueue(value);
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n"); buffer = frames.pop() || "";
        for (const frame of frames) {
          const line = frame.split("\n").find(item => item.startsWith("data:"));
          if (!line || line.includes("[DONE]")) continue;
          try { const data = JSON.parse(line.slice(5).trim()); if (data.usage) usage = { input: data.usage.prompt_tokens || 0, output: data.usage.completion_tokens || 0 }; } catch { /* pass through */ }
        }
      } catch (error) { await complete(); controller.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); await complete(); }
  });
}

/** 核心聊天逻辑：既供 /v1/chat/completions 使用，也供登录后的内部 Playground 使用（传入用户默认 Key）。 */
export async function runChatCompletion(c: Context<AppEnv>, token: ApiToken, body: Record<string, unknown>) {
  const requested = body.model as string;
  const allowedModels = parseJson<string[]>(token.allowed_models, ["*"]);
  if (!allowedModels.includes("*") && !allowedModels.includes(requested)) return openAiError(`此 Key 无权调用模型 ${requested}`, 403, "permission_error");
  const acquired = await acquire(token, c.env);
  if (!acquired.ok) return openAiError(acquired.message || "请求受限", 429, "rate_limit_error");
  const requestId = c.get("requestId") || id();
  const retry = await setting<RetrySettings>(c.env.DB, "retry", defaultRetry);
  const globalOutputCap = (await policy(c.env.DB)).maxOutputTokens || 0;
  let attempts = 0; let lastMessage = "没有可用渠道"; let lastProvider = ""; let lastModel = ""; let lastStatus = 502;
  try {
    const { targets } = await routeTargets(c.env.DB, requested);
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const hasVision = (body.messages as { content?: unknown }[]).some(message => Array.isArray(message.content) && message.content.some((part: { type?: string }) => part.type === "image_url"));
    const compatible = targets.filter(target => (!hasTools || target.model.supports_tools) && (!hasVision || target.model.supports_vision));
    if (!compatible.length) {
      await finishToken(c.env, token, { input: 0, output: 0 });
      return openAiError(`模型 ${requested} 不存在、已停用或不支持所需能力`, 404, "model_not_found");
    }

    outer: for (const target of compatible) {
      if (attempts >= retry.maxAttempts) break;
      lastProvider = target.provider.id; lastModel = target.model.id;
      const keys = await all<ProviderKey>(c.env.DB, `SELECT * FROM provider_keys WHERE provider_id=? AND enabled=1
        AND (cooldown_until IS NULL OR cooldown_until<?) ORDER BY last_used_at IS NOT NULL,last_used_at`, [target.provider.id, now()]);
      const totalKeys = await one<{ count: number }>(c.env.DB, "SELECT COUNT(*) count FROM provider_keys WHERE provider_id=? AND enabled=1", [target.provider.id]);
      const candidates: (ProviderKey | null)[] = totalKeys?.count ? keys : [null];
      for (const providerKey of candidates) {
        if (attempts >= retry.maxAttempts) break outer;
        attempts++;
        let secret = "";
        try {
          if (providerKey) {
            secret = await decryptSecret(providerKey.encrypted_key, c.env.KEY_ENCRYPTION_SECRET || "");
            await run(c.env.DB, "UPDATE provider_keys SET last_used_at=? WHERE id=?", [now(), providerKey.id]);
          }
          const response = await dispatch(c.env, target, secret, body, globalOutputCap);
          if (!response.ok) {
            lastStatus = response.status; lastMessage = (await response.text()).slice(0, 500);
            if (providerKey && [401, 402, 403, 429].includes(response.status)) {
              const cooldown = new Date(Date.now() + retry.cooldownSeconds * 1000).toISOString();
              await run(c.env.DB, "UPDATE provider_keys SET cooldown_until=?,last_error=? WHERE id=?", [cooldown, `HTTP ${response.status}`, providerKey.id]);
            }
            if (retry.retryStatuses.includes(response.status) || [401, 402, 403].includes(response.status)) continue;
            break outer;
          }
          const headers = new Headers(response.headers);
          headers.set("x-request-id", requestId); headers.set("x-ziheng-provider", encodeURIComponent(target.provider.name));
          headers.set("x-ziheng-model", encodeURIComponent(target.model.name)); headers.set("x-ziheng-attempts", String(attempts));
          if (body.stream) {
            const output = target.provider.protocol === "claude" ? claudeStreamToOpenAi(response.body!, target.model.name) : response.body!;
            return new Response(trackedStream(output, async usage => {
              await finishToken(c.env, token, usage); await recordUsage(c.env.DB, usage.input, usage.output);
            }), { status: 200, headers });
          }
          let responseBody: BodyInit | null = response.body;
          let usage: Usage = { input: 0, output: 0 };
          if (target.provider.protocol === "claude") {
            const data = await response.json<Record<string, unknown>>();
            const converted = claudeToOpenAi(data, target.model.name);
            usage = { input: converted.usage.prompt_tokens, output: converted.usage.completion_tokens };
            responseBody = JSON.stringify(converted); headers.set("content-type", "application/json; charset=utf-8");
          } else {
            const text = await response.text(); responseBody = text;
            const data = await Promise.resolve().then(() => JSON.parse(text) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).catch(() => null);
            usage = { input: data?.usage?.prompt_tokens || 0, output: data?.usage?.completion_tokens || 0 };
          }
          headers.delete("content-length");
          await finishToken(c.env, token, usage); await recordUsage(c.env.DB, usage.input, usage.output);
          return new Response(responseBody, { status: 200, headers });
        } catch (error) {
          lastStatus = 502; lastMessage = error instanceof Error ? error.message : "网络请求失败";
          if (providerKey) await run(c.env.DB, "UPDATE provider_keys SET cooldown_until=?,last_error=? WHERE id=?",
            [new Date(Date.now() + retry.cooldownSeconds * 1000).toISOString(), lastMessage.slice(0, 200), providerKey.id]);
        }
      }
    }
    await run(c.env.DB, `INSERT INTO error_logs(id,request_id,route_model,provider_id,model_id,token_id,status,message,attempts) VALUES(?,?,?,?,?,?,?,?,?)`,
      [id(), requestId, requested, lastProvider || null, lastModel || null, token.id, lastStatus, lastMessage, attempts]);
    await recordUsage(c.env.DB, 0, 0, true); await finishToken(c.env, token, { input: 0, output: 0 });
    return openAiError(`所有可用渠道均调用失败：${lastMessage}`, lastStatus >= 400 && lastStatus < 500 && lastStatus !== 429 ? lastStatus : 503, "upstream_error");
  } catch (error) {
    await finishToken(c.env, token, { input: 0, output: 0 });
    return openAiError(error instanceof Error ? error.message : "中转请求失败", 500, "internal_error");
  }
}

proxy.post("/chat/completions", async c => {
  const auth = await authenticate(c); if (auth.response || !auth.token) return auth.response!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body.model !== "string" || !Array.isArray(body.messages)) return openAiError("请求必须包含 model 和 messages", 422);
  return runChatCompletion(c, auth.token, body);
});
