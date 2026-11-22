import type { D1Database } from "@cloudflare/workers-types";

export async function one<T>(db: D1Database, sql: string, values: unknown[] = []): Promise<T | null> {
  return db.prepare(sql).bind(...values).first<T>();
}

export async function all<T>(db: D1Database, sql: string, values: unknown[] = []): Promise<T[]> {
  const result = await db.prepare(sql).bind(...values).all<T>();
  return result.results || [];
}

export async function run(db: D1Database, sql: string, values: unknown[] = []) {
  return db.prepare(sql).bind(...values).run();
}

export async function setting<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await one<{ value: string }>(db, "SELECT value FROM settings WHERE key = ?", [key]);
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}

export async function setSetting(db: D1Database, key: string, value: unknown) {
  await run(db, `INSERT INTO settings(key, value, updated_at) VALUES(?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`, [key, JSON.stringify(value)]);
}

export async function recordUsage(db: D1Database, input = 0, output = 0, error = false) {
  const day = new Date().toISOString().slice(0, 10);
  await run(db, `INSERT INTO usage_daily(day, requests, errors, input_tokens, output_tokens)
    VALUES(?, 1, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET requests = requests + 1, errors = errors + excluded.errors,
    input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`,
    [day, error ? 1 : 0, input, output]);
}

/** 按用户记录每月用量（仅普通用户 Key 关联 user_id 时调用） */
export async function recordUserUsage(db: D1Database, userId: string, input = 0, output = 0, error = false) {
  const month = new Date().toISOString().slice(0, 7);
  await run(db, `INSERT INTO user_usage_monthly(user_id, month, requests, errors, input_tokens, output_tokens)
    VALUES(?, ?, 1, ?, ?, ?)
    ON CONFLICT(user_id, month) DO UPDATE SET requests = requests + 1, errors = errors + excluded.errors,
    input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`,
    [userId, month, error ? 1 : 0, input, output]);
}

/* ---------------- 平台策略：免费额度 + 防滥用 ---------------- */
export type Policy = {
  monthlyRequestLimit: number;   // 新用户默认每月请求额度
  monthlyTokenLimit: number;     // 新用户默认每月 Token 额度
  perMinuteTokens: number;       // 普通用户每分钟 Token 上限（防滥用）
  abuseEnabled: boolean;         // 是否启用每分钟限流
  maxOutputTokens: number;       // 单次请求输出 Token 上限；0=不钳制。转发前钳制客户端过大的 max_tokens，避免上游 max_model_len 报 400
};
/** 适度默认值：满足个人 + 少量他人使用，避免过度赠送影响本人 */
export const DEFAULT_POLICY: Policy = {
  monthlyRequestLimit: 300,
  monthlyTokenLimit: 600000,
  perMinuteTokens: 12000,
  abuseEnabled: true,
  maxOutputTokens: 24000,
};
export async function policy(db: D1Database): Promise<Policy> {
  const p = await setting<Partial<Policy>>(db, "policy", {});
  return { ...DEFAULT_POLICY, ...p };
}

export const minuteKey = () => new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM

/** 读取某主体（用户）当前分钟已用 Token */
export async function minuteUsage(db: D1Database, subject: string, minute: string): Promise<number> {
  const row = await one<{ tokens: number }>(db, "SELECT tokens FROM rate_minute WHERE subject=? AND minute=?", [subject, minute]);
  return row?.tokens || 0;
}

/** 累加某主体当前分钟 Token 用量，并顺带清理过期分钟记录（低频） */
export async function recordMinuteUsage(db: D1Database, subject: string, minute: string, tokens: number) {
  await run(db, `INSERT INTO rate_minute(subject, minute, tokens, requests) VALUES(?, ?, ?, 1)
    ON CONFLICT(subject, minute) DO UPDATE SET tokens = tokens + excluded.tokens, requests = requests + 1`,
    [subject, minute, tokens]);
  // 概率性清理 2 小时前的记录，避免表无限增长
  if (Math.random() < 0.02) {
    await run(db, "DELETE FROM rate_minute WHERE minute < ?", [new Date(Date.now() - 2 * 3600000).toISOString().slice(0, 16)]);
  }
}
