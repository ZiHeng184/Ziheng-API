import type { Bindings } from "./types";
import { one, run, setSetting } from "./db";
import { sha256 } from "./crypto";
import { ensureAdmin } from "./auth";

const DEMO_PROVIDER = "demo-provider";
const DEMO_ROUTE = "demo-route-auto";
const DEMO_TOKEN = "demo-api-token";

export async function bootstrap(env: Bindings) {
  await ensureAdmin(env);
  if (env.DEMO_MODE !== "true") return;
  const seeded = await one<{ key: string }>(env.DB, "SELECT key FROM settings WHERE key = 'demo_seeded'");
  if (seeded) return;

  await run(env.DB, "INSERT OR IGNORE INTO providers(id, name, protocol, base_url, priority) VALUES(?, ?, 'openai', 'mock://local', 100)",
    [DEMO_PROVIDER, "内置模拟渠道 · 匿名"]);
  const models = [
    ["demo-model-flash", "ziheng-flash"],
    ["demo-model-pro", "ziheng-pro"],
    ["demo-model-vision", "ziheng-vision"]
  ];
  for (const [modelId, name] of models) {
    await run(env.DB, `INSERT OR IGNORE INTO models(id, provider_id, name, upstream_name, supports_tools, supports_vision)
      VALUES(?, ?, ?, ?, 1, 1)`, [modelId, DEMO_PROVIDER, name, name]);
  }
  await run(env.DB, "INSERT OR IGNORE INTO routes(id, name, description) VALUES(?, 'auto', '自动选择可用的模拟模型')", [DEMO_ROUTE]);
  await run(env.DB, "INSERT OR IGNORE INTO route_entries(id, route_id, position, provider_id, model_id) VALUES(?, ?, 0, ?, ?)",
    ["demo-entry-pro", DEMO_ROUTE, DEMO_PROVIDER, "demo-model-pro"]);
  await run(env.DB, "INSERT OR IGNORE INTO route_entries(id, route_id, position, provider_id, model_id) VALUES(?, ?, 1, ?, ?)",
    ["demo-entry-flash", DEMO_ROUTE, DEMO_PROVIDER, "demo-model-flash"]);
  const demoToken = "zh-sk-ziheng-demo-2026";
  await run(env.DB, `INSERT OR IGNORE INTO api_tokens(id, name, key_hash, prefix, request_limit, token_limit, concurrency_limit)
    VALUES(?, '公网演示 Key', ?, 'zh-sk-ziheng…2026', 1000, 1000000, 10)`, [DEMO_TOKEN, await sha256(demoToken)]);
  for (let offset = 6; offset >= 0; offset--) {
    const day = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
    const factor = 7 - offset;
    await run(env.DB, "INSERT OR IGNORE INTO usage_daily(day, requests, errors, input_tokens, output_tokens) VALUES(?, ?, ?, ?, ?)",
      [day, 18 + factor * 7, factor % 3, 2400 + factor * 880, 5100 + factor * 1420]);
  }
  await setSetting(env.DB, "retry", { maxAttempts: 6, timeoutMs: 60000, retryStatuses: [408, 409, 425, 429, 500, 502, 503, 504], cooldownSeconds: 60 });
  await setSetting(env.DB, "demo_seeded", true);
}
