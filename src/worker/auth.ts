import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { AppEnv, Bindings } from "./types";
import { now } from "./types";
import { one, run } from "./db";
import { hashPassword, sha256, verifyPassword } from "./crypto";
import { clientIp, fail } from "./http";

const COOKIE = "ziheng_session";
const SESSION_HOURS = 24 * 7;

export async function ensureAdmin(env: Bindings) {
  const existing = await one<{ id: string }>(env.DB, "SELECT id FROM admin_users LIMIT 1");
  if (existing) return;
  const username = env.ADMIN_USERNAME || (env.DEMO_MODE === "true" ? "admin" : "admin");
  const password = env.ADMIN_PASSWORD || (env.DEMO_MODE === "true" ? "Ziheng2026!" : "");
  if (!password) throw new Error("首次启动需要设置 ADMIN_PASSWORD");
  const { salt, hash } = await hashPassword(password);
  await run(env.DB, "INSERT OR IGNORE INTO admin_users(id, username, password_hash, password_salt) VALUES('admin', ?, ?, ?)",
    [username, hash, salt]);
}

async function throttle(ip: string, env: Bindings) {
  const window = Math.floor(Date.now() / 900000);
  const row = await one<{ window_start: number; count: number }>(env.DB, "SELECT * FROM login_attempts WHERE ip = ?", [ip]);
  if (!row) {
    await run(env.DB, "INSERT INTO login_attempts(ip, window_start, count) VALUES(?, ?, 1)", [ip, window]);
    return false;
  }
  const count = row.window_start === window ? row.count + 1 : 1;
  await run(env.DB, "UPDATE login_attempts SET window_start = ?, count = ? WHERE ip = ?", [window, count, ip]);
  return row.window_start === window && row.count >= 8;
}

export async function login(c: Context<AppEnv>) {
  await ensureAdmin(c.env);
  const ip = clientIp(c);
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => ({})) as { username?: string; password?: string };
  if (!body.username || !body.password) return fail(c, "请输入用户名和密码", 422);
  const window = Math.floor(Date.now() / 900000);
  const attempts = await one<{ count: number; window_start: number }>(c.env.DB, "SELECT * FROM login_attempts WHERE ip = ?", [ip]);
  if (attempts?.window_start === window && attempts.count >= 8) return fail(c, "尝试次数过多，请 15 分钟后重试", 429);
  const user = await one<{ id: string; password_hash: string; password_salt: string; role: string; enabled: number }>(c.env.DB,
    "SELECT * FROM admin_users WHERE username = ?", [body.username]);
  const valid = user && await verifyPassword(body.password, user.password_salt, user.password_hash);
  if (!user || !valid) {
    if (await throttle(ip, c.env)) return fail(c, "尝试次数过多，请 15 分钟后重试", 429);
    return fail(c, "用户名或密码错误", 401);
  }
  if (!user.enabled) return fail(c, "账号已被停用，请联系管理员", 403);
  await run(c.env.DB, "DELETE FROM login_attempts WHERE ip = ?", [ip]);
  const expires = await createSession(c, user.id);
  return c.json({ success: true, data: { username: body.username, role: user.role, expiresAt: expires } });
}

export async function logout(c: Context<AppEnv>) {
  const session = getCookie(c, COOKIE);
  if (session) await run(c.env.DB, "DELETE FROM sessions WHERE id_hash = ?", [await sha256(session)]);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ success: true });
}

export async function currentAdmin(env: Bindings, session?: string) {
  if (!session) return null;
  return one<{ id: string; username: string; role: string; email: string | null; expires_at: string }>(env.DB,
    `SELECT u.id, u.username, u.role, u.email, s.expires_at FROM sessions s JOIN admin_users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ? AND u.enabled = 1`, [await sha256(session), now()]);
}

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = await currentAdmin(c.env, getCookie(c, COOKIE));
  if (!user) return fail(c, "登录已失效，请重新登录", 401);
  if (user.role !== "admin") return fail(c, "需要管理员权限", 403);
  c.set("user", user);
  await next();
});

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = await currentAdmin(c.env, getCookie(c, COOKIE));
  if (!user) return fail(c, "登录已失效，请重新登录", 401);
  c.set("user", user);
  await next();
});

export function sessionCookieName() { return COOKIE; }

export async function createSession(c: Context<AppEnv>, userId: string) {
  const session = crypto.randomUUID() + crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
  await run(c.env.DB, "INSERT INTO sessions(id_hash, user_id, expires_at, ip, user_agent) VALUES(?, ?, ?, ?, ?)",
    [await sha256(session), userId, expires, clientIp(c), c.req.header("user-agent") || ""]);
  const forwardedProto = c.req.header("x-forwarded-proto") || c.req.header("cf-visitor") || "";
  setCookie(c, COOKIE, session, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:" || forwardedProto.includes("https"),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600
  });
  return expires;
}

export async function sessionInfo(c: Context<AppEnv>) {
  const user = await currentAdmin(c.env, getCookie(c, COOKIE));
  return c.json({ success: true, data: user ? { id: user.id, username: user.username, role: user.role, email: user.email, expiresAt: user.expires_at } : null });
}
