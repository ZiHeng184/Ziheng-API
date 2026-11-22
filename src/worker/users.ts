import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, ApiToken } from "./types";
import { id, json, now, parseJson } from "./types";
import { all, one, run, policy } from "./db";
import { createApiToken, hashPassword, sha256, verifyPassword } from "./crypto";
import { clientIp, fail, ok } from "./http";
import { createSession } from "./auth";
import { logMail, mailConfig, saveMailConfig, sendMail, verificationHtml } from "./mail";
import { buildCatalog, runChatCompletion } from "./proxy";

export const publicAuth = new Hono<AppEnv>();
export const me = new Hono<AppEnv>();
export const userAdmin = new Hono<AppEnv>();

type CurrentUser = { id: string; username: string; role: string; email: string | null };
const currentUser = (c: Context<AppEnv>) => c.get("user") as CurrentUser;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------------- 邮箱验证码（注册） ---------------- */
publicAuth.post("/email-code", async c => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({})) as { email?: string };
  const email = (body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return fail(c, "请输入有效的邮箱地址", 422);
  const existing = await one(c.env.DB, "SELECT id FROM admin_users WHERE email = ?", [email]);
  if (existing) return fail(c, "该邮箱已注册，请直接登录", 409);

  const recent = await one<{ created_at: string }>(c.env.DB,
    "SELECT created_at FROM email_codes WHERE email=? AND purpose='register' ORDER BY created_at DESC LIMIT 1", [email]);
  if (recent && Date.now() - new Date(recent.created_at).getTime() < 60000) return fail(c, "发送过于频繁，请 60 秒后再试", 429);
  const ip = clientIp(c);
  const ipCount = await one<{ count: number }>(c.env.DB,
    "SELECT COUNT(*) count FROM mail_logs WHERE purpose='register' AND status='sent' AND created_at > datetime('now','-1 hour')");
  if ((ipCount?.count || 0) >= 30) return fail(c, "验证码发送已达上限，请稍后再试", 429);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 10 * 60000).toISOString();
  await run(c.env.DB, "INSERT INTO email_codes(id,email,purpose,code_hash,expires_at) VALUES(?,?,'register',?,?)",
    [id(), email, await sha256(`${email}:${code}`), expires]);

  const config = await mailConfig(c.env);
  if (!config) {
    if (c.env.MAIL_DEV_ECHO === "true") {
      await logMail(c.env, email, "register", "dev-echo", ip);
      return ok(c, { sent: false, devCode: code, message: "邮件服务未配置，当前为开发回显模式" });
    }
    return fail(c, "邮件服务尚未配置，请联系管理员完成发件设置", 503);
  }
  try {
    await sendMail(c.env, config, email, `Ziheng API 验证码：${code}`, verificationHtml(code), `你的 Ziheng API 注册验证码是 ${code}，10 分钟内有效。`);
    await logMail(c.env, email, "register", "sent", ip);
    return ok(c, { sent: true, message: "验证码已发送，请查收邮箱（含垃圾邮件）" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "发送失败";
    await logMail(c.env, email, "register", "failed", message);
    return fail(c, `验证码发送失败：${message}`, 502);
  }
});

/* ---------------- 邀请码 + 邮箱验证码注册 ---------------- */
publicAuth.post("/register", async c => {
  const b = await c.req.json<{ username?: string; email?: string; password?: string; inviteCode?: string; emailCode?: string }>()
    .catch(() => ({})) as Record<string, string | undefined>;
  const username = (b.username || "").trim();
  const email = (b.email || "").trim().toLowerCase();
  const password = b.password || "";
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return fail(c, "用户名需为 3-24 位字母、数字或下划线", 422);
  if (!EMAIL_RE.test(email)) return fail(c, "请输入有效的邮箱地址", 422);
  if (password.length < 12) return fail(c, "密码至少需要 12 个字符", 422);
  if (!b.inviteCode?.trim()) return fail(c, "请输入邀请码", 422);
  if (!b.emailCode?.trim()) return fail(c, "请输入邮箱验证码", 422);

  const invite = await one<{ id: string; used_count: number; max_uses: number; expires_at: string | null }>(c.env.DB,
    "SELECT * FROM invites WHERE code=? AND enabled=1", [b.inviteCode.trim()]);
  if (!invite) return fail(c, "邀请码不存在或已停用", 403);
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) return fail(c, "邀请码已过期", 403);
  if (invite.used_count >= invite.max_uses) return fail(c, "邀请码使用次数已达上限", 403);

  const emailCode = await one<{ id: string; code_hash: string; expires_at: string; attempts: number }>(c.env.DB,
    "SELECT * FROM email_codes WHERE email=? AND purpose='register' AND used=0 ORDER BY created_at DESC LIMIT 1", [email]);
  if (!emailCode) return fail(c, "请先获取邮箱验证码", 422);
  if (new Date(emailCode.expires_at).getTime() <= Date.now()) return fail(c, "验证码已过期，请重新获取", 422);
  if (emailCode.attempts >= 5) return fail(c, "验证码错误次数过多，请重新获取", 429);
  const expected = await sha256(`${email}:${b.emailCode.trim()}`);
  if (expected !== emailCode.code_hash) {
    await run(c.env.DB, "UPDATE email_codes SET attempts=attempts+1 WHERE id=?", [emailCode.id]);
    return fail(c, "邮箱验证码不正确", 422);
  }

  if (await one(c.env.DB, "SELECT id FROM admin_users WHERE username=?", [username])) return fail(c, "用户名已被占用", 409);
  if (await one(c.env.DB, "SELECT id FROM admin_users WHERE email=?", [email])) return fail(c, "该邮箱已注册", 409);

  const userId = id();
  const { salt, hash } = await hashPassword(password);
  const pol = await policy(c.env.DB);
  await run(c.env.DB, "INSERT INTO admin_users(id,username,password_hash,password_salt,role,email,enabled,monthly_request_limit,monthly_token_limit) VALUES(?,?,?,?,'user',?,1,?,?)",
    [userId, username, hash, salt, email, pol.monthlyRequestLimit, pol.monthlyTokenLimit]);
  // 注册即创建内置默认 Key：不可删除、不可停用、仅供 Playground 内部调用
  const raw = createApiToken(); const tokenId = id();
  await run(c.env.DB, `INSERT INTO api_tokens(id,name,key_hash,prefix,allowed_models,allowed_ips,request_limit,token_limit,concurrency_limit,user_id,kind)
    VALUES(?,?,?,?,?,?,?,?,?,?, 'default')`,
    [tokenId, "Playground 默认密钥", await sha256(raw), `${raw.slice(0, 12)}…${raw.slice(-4)}`,
      json(["*"]), json([]), null, null, null, userId]);
  await run(c.env.DB, "UPDATE email_codes SET used=1 WHERE id=?", [emailCode.id]);
  await run(c.env.DB, "UPDATE invites SET used_count=used_count+1 WHERE id=?", [invite.id]);
  const expires = await createSession(c, userId);
  return ok(c, { username, role: "user", email, expiresAt: expires }, 201);
});

/* ---------------- 普通用户自助接口 ---------------- */
me.get("/profile", async c => {
  const user = currentUser(c);
  const usage = await one<{ tokens: number; requests: number; used_tokens: number }>(c.env.DB,
    `SELECT COUNT(*) tokens, COALESCE(SUM(used_requests),0) requests, COALESCE(SUM(used_tokens),0) used_tokens
     FROM api_tokens WHERE user_id=?`, [user.id]);
  const created = await one<{ created_at: string; monthly_request_limit: number | null; monthly_token_limit: number | null }>(c.env.DB,
    "SELECT created_at,monthly_request_limit,monthly_token_limit FROM admin_users WHERE id=?", [user.id]);
  const month = new Date().toISOString().slice(0, 7);
  const monthUsage = await one<{ requests: number; input_tokens: number; output_tokens: number }>(c.env.DB,
    "SELECT requests,input_tokens,output_tokens FROM user_usage_monthly WHERE user_id=? AND month=?", [user.id, month]);
  return ok(c, { username: user.username, email: user.email, role: user.role, createdAt: created?.created_at, usage,
    quota: { requestLimit: created?.monthly_request_limit ?? null, tokenLimit: created?.monthly_token_limit ?? null,
      usedRequests: monthUsage?.requests || 0, usedTokens: (monthUsage?.input_tokens || 0) + (monthUsage?.output_tokens || 0), month } });
});

/* 模型广场（普通用户）：可见模型、能力、渠道健康度、命名路由 */
me.get("/catalog", async c => ok(c, await buildCatalog(c.env.DB, currentUser(c).id)));

/* Playground：会话鉴权，使用用户内置默认 Key 走真实中转链路 */
me.post("/playground/chat", async c => {
  const user = currentUser(c);
  const token = await one<ApiToken>(c.env.DB, "SELECT * FROM api_tokens WHERE user_id=? AND kind='default' AND enabled=1 LIMIT 1", [user.id]);
  if (!token) return fail(c, "未找到 Playground 默认密钥，请联系管理员", 403);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body.model !== "string" || !Array.isArray(body.messages)) return fail(c, "请求必须包含 model 和 messages", 422);
  return runChatCompletion(c, token, body);
});

me.post("/password", async c => {
  const user = currentUser(c);
  const b = await c.req.json<{ current?: string; password?: string }>().catch(() => ({})) as { current?: string; password?: string };
  if (!b.current || !b.password || b.password.length < 12) return fail(c, "新密码至少需要 12 个字符", 422);
  const row = await one<{ password_hash: string; password_salt: string }>(c.env.DB, "SELECT password_hash,password_salt FROM admin_users WHERE id=?", [user.id]);
  if (!row || !await verifyPassword(b.current, row.password_salt, row.password_hash)) return fail(c, "当前密码不正确", 403);
  const { salt, hash } = await hashPassword(b.password);
  await run(c.env.DB, "UPDATE admin_users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?", [hash, salt, now(), user.id]);
  await run(c.env.DB, "DELETE FROM sessions WHERE user_id=?", [user.id]);
  return ok(c, null);
});

me.get("/tokens", async c => {
  const user = currentUser(c);
  const tokens = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM api_tokens WHERE user_id=? ORDER BY created_at DESC", [user.id]);
  return ok(c, tokens.map(t => ({ ...t, key_hash: undefined, allowed_models: parseJson(t.allowed_models as string, []), allowed_ips: parseJson(t.allowed_ips as string, []) })));
});

me.post("/tokens", async c => {
  const user = currentUser(c);
  const b = await c.req.json().catch(() => ({})) as Record<string, any>;
  if (!b.name?.trim()) return fail(c, "请输入 Key 名称", 422);
  const raw = createApiToken(); const tokenId = id();
  await run(c.env.DB, `INSERT INTO api_tokens(id,name,key_hash,prefix,expires_at,allowed_models,allowed_ips,request_limit,token_limit,concurrency_limit,user_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [tokenId, b.name.trim(), await sha256(raw), `${raw.slice(0, 12)}…${raw.slice(-4)}`,
    b.expires_at || null, json(b.allowed_models?.length ? b.allowed_models : ["*"]), json([]),
    b.request_limit || null, b.token_limit || null, b.concurrency_limit || null, user.id]);
  return ok(c, { id: tokenId, token: raw }, 201);
});

me.patch("/tokens/:id", async c => {
  const user = currentUser(c);
  const owned = await one<{ id: string; kind: string }>(c.env.DB, "SELECT id,kind FROM api_tokens WHERE id=? AND user_id=?", [c.req.param("id"), user.id]);
  if (!owned) return fail(c, "Key 不存在", 404);
  const b = await c.req.json().catch(() => ({})) as Record<string, any>;
  if (owned.kind === "default" && b.enabled === false) return fail(c, "Playground 默认密钥不可停用", 403);
  const sets: string[] = []; const values: unknown[] = [];
  // 默认密钥仅允许改名，其余属性固定，保证内部 Playground 稳定可用
  const editable = owned.kind === "default" ? ["name"] : ["name", "expires_at", "request_limit", "token_limit", "concurrency_limit"];
  for (const key of editable) {
    if (b[key] !== undefined) { sets.push(`${key}=?`); values.push(b[key] || null); }
  }
  if (owned.kind !== "default") {
    if (b.enabled !== undefined) { sets.push("enabled=?"); values.push(b.enabled ? 1 : 0); }
    if (b.allowed_models !== undefined) { sets.push("allowed_models=?"); values.push(json(b.allowed_models)); }
  }
  if (sets.length) { values.push(owned.id); await run(c.env.DB, `UPDATE api_tokens SET ${sets.join(",")} WHERE id=?`, values); }
  return ok(c, null);
});

me.post("/tokens/:id/reset", async c => {
  const user = currentUser(c);
  await run(c.env.DB, "UPDATE api_tokens SET used_requests=0,used_tokens=0 WHERE id=? AND user_id=?", [c.req.param("id"), user.id]);
  return ok(c, null);
});

me.delete("/tokens/:id", async c => {
  const user = currentUser(c);
  const owned = await one<{ kind: string }>(c.env.DB, "SELECT kind FROM api_tokens WHERE id=? AND user_id=?", [c.req.param("id"), user.id]);
  if (!owned) return fail(c, "Key 不存在", 404);
  if (owned.kind === "default") return fail(c, "Playground 默认密钥不可删除", 403);
  await run(c.env.DB, "DELETE FROM api_tokens WHERE id=? AND user_id=?", [c.req.param("id"), user.id]);
  return ok(c, null);
});

/* ---------------- 管理员：用户与邀请码 ---------------- */
userAdmin.get("/users", async c => {
  const month = new Date().toISOString().slice(0, 7);
  const users = await all(c.env.DB, `SELECT u.id,u.username,u.email,u.role,u.enabled,u.created_at,
    u.monthly_request_limit,u.monthly_token_limit,
    (SELECT COUNT(*) FROM api_tokens t WHERE t.user_id=u.id) token_count,
    (SELECT COALESCE(SUM(used_requests),0) FROM api_tokens t WHERE t.user_id=u.id) used_requests,
    COALESCE((SELECT um.requests FROM user_usage_monthly um WHERE um.user_id=u.id AND um.month='${month}'),0) month_requests,
    COALESCE((SELECT um.input_tokens+um.output_tokens FROM user_usage_monthly um WHERE um.user_id=u.id AND um.month='${month}'),0) month_tokens
    FROM admin_users u ORDER BY u.created_at`);
  return ok(c, users);
});

userAdmin.patch("/users/:id", async c => {
  const actor = currentUser(c);
  const targetId = c.req.param("id");
  const b = await c.req.json().catch(() => ({})) as Record<string, any>;
  const target = await one<{ id: string; role: string }>(c.env.DB, "SELECT id,role FROM admin_users WHERE id=?", [targetId]);
  if (!target) return fail(c, "用户不存在", 404);
  if (targetId === actor.id && b.enabled === false) return fail(c, "不能停用自己的账号", 422);
  if (target.role === "admin" && (b.enabled === false || b.role === "user")) {
    const admins = await one<{ count: number }>(c.env.DB, "SELECT COUNT(*) count FROM admin_users WHERE role='admin' AND enabled=1");
    if ((admins?.count || 0) <= 1) return fail(c, "至少需要保留一名可用管理员", 422);
  }
  const sets: string[] = []; const values: unknown[] = [];
  if (b.enabled !== undefined) { sets.push("enabled=?"); values.push(b.enabled ? 1 : 0); }
  if (b.role !== undefined && ["admin", "user"].includes(b.role)) { sets.push("role=?"); values.push(b.role); }
  if (b.monthly_request_limit !== undefined) { sets.push("monthly_request_limit=?"); values.push(b.monthly_request_limit === null || b.monthly_request_limit === "" ? null : Math.max(0, Number(b.monthly_request_limit) || 0)); }
  if (b.monthly_token_limit !== undefined) { sets.push("monthly_token_limit=?"); values.push(b.monthly_token_limit === null || b.monthly_token_limit === "" ? null : Math.max(0, Number(b.monthly_token_limit) || 0)); }
  if (!sets.length) return fail(c, "没有可更新的字段", 422);
  values.push(targetId);
  await run(c.env.DB, `UPDATE admin_users SET ${sets.join(",")},updated_at=datetime('now') WHERE id=?`, values);
  if (b.enabled === false) await run(c.env.DB, "DELETE FROM sessions WHERE user_id=?", [targetId]);
  return ok(c, null);
});

userAdmin.post("/users/:id/reset-password", async c => {
  const targetId = c.req.param("id");
  const target = await one(c.env.DB, "SELECT id FROM admin_users WHERE id=?", [targetId]);
  if (!target) return fail(c, "用户不存在", 404);
  const password = `Zh${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}!`;
  const { salt, hash } = await hashPassword(password);
  await run(c.env.DB, "UPDATE admin_users SET password_hash=?,password_salt=?,updated_at=datetime('now') WHERE id=?", [hash, salt, targetId]);
  await run(c.env.DB, "DELETE FROM sessions WHERE user_id=?", [targetId]);
  return ok(c, { password });
});

userAdmin.delete("/users/:id", async c => {
  const actor = currentUser(c);
  const targetId = c.req.param("id");
  if (targetId === actor.id) return fail(c, "不能删除自己的账号", 422);
  const target = await one<{ role: string }>(c.env.DB, "SELECT role FROM admin_users WHERE id=?", [targetId]);
  if (!target) return fail(c, "用户不存在", 404);
  if (target.role === "admin") {
    const admins = await one<{ count: number }>(c.env.DB, "SELECT COUNT(*) count FROM admin_users WHERE role='admin'");
    if ((admins?.count || 0) <= 1) return fail(c, "至少需要保留一名管理员", 422);
  }
  await run(c.env.DB, "DELETE FROM api_tokens WHERE user_id=?", [targetId]);
  await run(c.env.DB, "DELETE FROM sessions WHERE user_id=?", [targetId]);
  await run(c.env.DB, "DELETE FROM admin_users WHERE id=?", [targetId]);
  return ok(c, null);
});

userAdmin.get("/invites", async c => ok(c, await all(c.env.DB, "SELECT * FROM invites ORDER BY created_at DESC")));

userAdmin.post("/invites", async c => {
  const b = await c.req.json().catch(() => ({})) as Record<string, any>;
  const code = (b.code || `ZH-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`).trim();
  if (!/^[a-zA-Z0-9-]{4,40}$/.test(code)) return fail(c, "邀请码需为 4-40 位字母、数字或连字符", 422);
  try {
    await run(c.env.DB, "INSERT INTO invites(id,code,note,max_uses,expires_at) VALUES(?,?,?,?,?)",
      [id(), code, b.note || "", Math.max(1, Number(b.max_uses) || 1), b.expires_at || null]);
  } catch { return fail(c, "邀请码已存在", 409); }
  return ok(c, { code }, 201);
});

userAdmin.patch("/invites/:id", async c => {
  const b = await c.req.json().catch(() => ({})) as Record<string, any>;
  const sets: string[] = []; const values: unknown[] = [];
  if (b.enabled !== undefined) { sets.push("enabled=?"); values.push(b.enabled ? 1 : 0); }
  if (b.max_uses !== undefined) { sets.push("max_uses=?"); values.push(Math.max(1, Number(b.max_uses) || 1)); }
  if (b.note !== undefined) { sets.push("note=?"); values.push(String(b.note)); }
  if (!sets.length) return fail(c, "没有可更新的字段", 422);
  values.push(c.req.param("id"));
  await run(c.env.DB, `UPDATE invites SET ${sets.join(",")} WHERE id=?`, values);
  return ok(c, null);
});

userAdmin.delete("/invites/:id", async c => { await run(c.env.DB, "DELETE FROM invites WHERE id=?", [c.req.param("id")]); return ok(c, null); });

/* ---------------- 管理员：邮件服务配置 ---------------- */
userAdmin.get("/mail", async c => {
  const config = await mailConfig(c.env);
  const logs = await all(c.env.DB, "SELECT email,purpose,status,message,created_at FROM mail_logs ORDER BY created_at DESC LIMIT 20");
  return ok(c, {
    configured: !!config,
    provider: config?.provider || c.env.MAIL_PROVIDER || "resend",
    from: config?.from || c.env.MAIL_FROM || "",
    fromName: config?.fromName || "Ziheng API",
    smtpHost: config?.smtpHost || "",
    smtpPort: config?.smtpPort || 0,
    smtpSecurity: config?.smtpSecurity || "auto",
    devEcho: c.env.MAIL_DEV_ECHO === "true",
    logs
  });
});

userAdmin.post("/mail", async c => {
  const b = await c.req.json().catch(() => ({})) as Record<string, any>;
  if (!["resend", "brevo", "mailersend", "smtp"].includes(b.provider)) return fail(c, "不支持的邮件服务商", 422);
  if (!b.from || !EMAIL_RE.test(b.from)) return fail(c, "请输入有效的发件人邮箱地址", 422);
  const secret = b.apiKey?.trim() || undefined;
  const existing = await mailConfig(c.env);
  if (b.provider === "smtp" && !secret && existing?.provider !== "smtp") return fail(c, "请填写邮箱授权码", 422);
  if (b.provider !== "smtp" && !secret && existing?.provider === "smtp") return fail(c, "切换服务商后请填写新的 API Key", 422);
  const smtpHost = (b.smtpHost || "").trim();
  if (b.provider === "smtp" && smtpHost && !/^[a-zA-Z0-9.-]+$/.test(smtpHost)) return fail(c, "SMTP 主机格式不正确", 422);
  const smtpPort = Number(b.smtpPort) || undefined;
  if (smtpPort && (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)) return fail(c, "SMTP 端口范围应为 1–65535", 422);
  await saveMailConfig(c.env, {
    provider: b.provider,
    from: b.from.trim(),
    fromName: b.fromName,
    apiKey: secret,
    smtpHost,
    smtpPort,
    smtpSecurity: b.smtpSecurity
  });
  return ok(c, null);
});

userAdmin.post("/mail/test", async c => {
  const b = await c.req.json().catch(() => ({})) as Record<string, any>;
  const email = (b.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return fail(c, "请输入有效的收件邮箱", 422);
  const config = await mailConfig(c.env);
  if (!config) return fail(c, "请先保存邮件服务配置（API Key / 授权码与发件邮箱）", 422);
  try {
    await sendMail(c.env, config, email, "Ziheng API 邮件配置测试", "<p>这是一封来自 Ziheng API 的测试邮件，说明你的发件配置已生效。</p>", "Ziheng API 邮件配置测试成功。");
    await logMail(c.env, email, "test", "sent");
    return ok(c, { message: "测试邮件已发送" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "发送失败";
    await logMail(c.env, email, "test", "failed", message);
    return fail(c, message, 502);
  }
});
