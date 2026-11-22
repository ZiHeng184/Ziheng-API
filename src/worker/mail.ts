import { connect } from "cloudflare:sockets";
import type { Bindings } from "./types";
import { run, setting } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import { id } from "./types";

export type MailProvider = "resend" | "brevo" | "mailersend" | "smtp";
export type SmtpSecurity = "auto" | "tls" | "starttls";

export type MailConfig = {
  provider: MailProvider;
  apiKey: string;
  from: string;
  fromName: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: SmtpSecurity;
};

type StoredMail = {
  provider?: string;
  apiKeyEncrypted?: string;
  from?: string;
  fromName?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: string;
};

type SmtpPreset = { host: string; port: number; security: "tls" | "starttls" };

const SMTP_PRESETS: Record<string, SmtpPreset> = {
  "qq.com": { host: "smtp.qq.com", port: 465, security: "tls" },
  "foxmail.com": { host: "smtp.qq.com", port: 465, security: "tls" },
  "163.com": { host: "smtp.163.com", port: 465, security: "tls" },
  "126.com": { host: "smtp.126.com", port: 465, security: "tls" },
  "yeah.net": { host: "smtp.yeah.net", port: 465, security: "tls" },
  "139.com": { host: "smtp.139.com", port: 465, security: "tls" },
  "sina.com": { host: "smtp.sina.com", port: 465, security: "tls" },
  "sina.cn": { host: "smtp.sina.com", port: 465, security: "tls" },
  "21cn.com": { host: "smtp.21cn.com", port: 465, security: "tls" },
  "gmail.com": { host: "smtp.gmail.com", port: 465, security: "tls" },
  "googlemail.com": { host: "smtp.gmail.com", port: 465, security: "tls" },
  "outlook.com": { host: "smtp.office365.com", port: 587, security: "starttls" },
  "hotmail.com": { host: "smtp.office365.com", port: 587, security: "starttls" },
  "live.com": { host: "smtp.office365.com", port: 587, security: "starttls" },
  "yahoo.com": { host: "smtp.mail.yahoo.com", port: 465, security: "tls" },
  "icloud.com": { host: "smtp.mail.me.com", port: 587, security: "starttls" },
  "me.com": { host: "smtp.mail.me.com", port: 587, security: "starttls" },
  "mac.com": { host: "smtp.mail.me.com", port: 587, security: "starttls" }
};

function smtpPreset(email: string): SmtpPreset {
  const domain = email.split("@")[1]?.toLowerCase().trim() || "";
  return SMTP_PRESETS[domain] || { host: `smtp.${domain}`, port: 587, security: "starttls" };
}

function normalizeSecurity(value: unknown): SmtpSecurity {
  return value === "tls" || value === "starttls" ? value : "auto";
}

/** 读取邮件配置：优先后台 settings，其次 Worker 环境变量。 */
export async function mailConfig(env: Bindings): Promise<MailConfig | null> {
  const stored = await setting<StoredMail>(env.DB, "mail", {});
  const provider = (stored.provider || env.MAIL_PROVIDER || "resend") as MailProvider;
  const from = stored.from || env.MAIL_FROM || "";
  const fromName = stored.fromName || env.MAIL_FROM_NAME || "Ziheng API";
  const smtpHost = stored.smtpHost || env.MAIL_SMTP_HOST || "";
  const smtpPort = Number(stored.smtpPort || env.MAIL_SMTP_PORT || 0) || undefined;
  const smtpSecurity = normalizeSecurity(stored.smtpSecurity || env.MAIL_SMTP_SECURITY);
  let apiKey = env.MAIL_API_KEY || "";
  if (stored.apiKeyEncrypted) {
    try { apiKey = await decryptSecret(stored.apiKeyEncrypted, env.KEY_ENCRYPTION_SECRET || ""); } catch { /* 忽略损坏配置 */ }
  }
  if (!apiKey || !from) return null;
  return { provider, apiKey, from, fromName, smtpHost, smtpPort, smtpSecurity };
}

export async function saveMailConfig(env: Bindings, input: {
  provider: string;
  from: string;
  fromName?: string;
  apiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: string;
}) {
  const previous = await setting<StoredMail>(env.DB, "mail", {});
  const next: StoredMail = {
    provider: input.provider,
    from: input.from,
    fromName: input.fromName || "Ziheng API",
    smtpHost: input.smtpHost?.trim() || undefined,
    smtpPort: input.smtpPort || undefined,
    smtpSecurity: normalizeSecurity(input.smtpSecurity),
    apiKeyEncrypted: input.apiKey
      ? await encryptSecret(input.apiKey, env.KEY_ENCRYPTION_SECRET || "")
      : previous.apiKeyEncrypted
  };
  await run(env.DB, `INSERT INTO settings(key,value,updated_at) VALUES('mail',?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`, [JSON.stringify(next)]);
}

export async function sendMail(env: Bindings, config: MailConfig, to: string, subject: string, html: string, text: string) {
  if (config.provider === "smtp") return sendSmtpMail(config, to, subject, html, text);

  let response: Response;
  if (config.provider === "brevo") {
    response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": config.apiKey },
      body: JSON.stringify({ sender: { email: config.from, name: config.fromName }, to: [{ email: to }], subject, htmlContent: html, textContent: text })
    });
  } else if (config.provider === "mailersend") {
    response = await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ from: { email: config.from, name: config.fromName }, to: [{ email: to }], subject, html, text })
    });
  } else {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ from: `${config.fromName} <${config.from}>`, to: [to], subject, html, text })
    });
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`邮件服务返回 ${response.status}：${detail}`);
  }
}

/* ---------------- 通用 SMTP（邮箱地址 + 授权码） ---------------- */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
type SmtpReader = ReadableStreamDefaultReader<Uint8Array>;
type SmtpWriter = WritableStreamDefaultWriter<Uint8Array>;
type ResponseState = { buffer: string; pending?: { code: number; lines: string[] } };
type SmtpResponse = { code: number; lines: string[] };

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

function base64Utf8(value: string) {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodeHeader(value: string) {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${base64Utf8(value)}?=`;
}

function wrapLines(value: string, width = 76) {
  return value.match(new RegExp(`.{1,${width}}`, "g"))?.join("\r\n") || "";
}

function dotStuff(value: string) {
  return value.replace(/\r?\n/g, "\r\n").split("\r\n").map(line => line.startsWith(".") ? `.${line}` : line).join("\r\n");
}

function buildMime(config: MailConfig, to: string, subject: string, html: string, text: string) {
  const boundary = `----ziheng_${crypto.randomUUID().replaceAll("-", "")}`;
  const headers = [
    `From: ${encodeHeader(config.fromName)} <${config.from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "Auto-Submitted: auto-generated"
  ].join("\r\n");
  return `${headers}\r\n\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapLines(base64Utf8(text))}\r\n` +
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrapLines(base64Utf8(html))}\r\n` +
    `--${boundary}--\r\n`;
}

async function readSmtpResponse(reader: SmtpReader, state: ResponseState): Promise<SmtpResponse> {
  while (true) {
    if (!state.pending) {
      const { value, done } = await withTimeout(reader.read(), 15000, "SMTP 服务器响应超时");
      if (done) throw new Error("SMTP 连接意外关闭");
      state.buffer += decoder.decode(value, { stream: true });
    }
    let index = state.buffer.indexOf("\r\n");
    while (index >= 0) {
      const line = state.buffer.slice(0, index);
      state.buffer = state.buffer.slice(index + 2);
      if (state.pending) {
        state.pending.lines.push(line);
        if (new RegExp(`^${state.pending.code} `).test(line)) {
          const result = state.pending;
          delete state.pending;
          return result;
        }
      } else {
        const match = line.match(/^(\d{3})([ -])(.*)$/);
        if (match) {
          const code = Number(match[1]);
          const lines = [line];
          if (match[2] === " ") return { code, lines };
          state.pending = { code, lines };
        }
      }
      index = state.buffer.indexOf("\r\n");
    }
  }
}

async function smtpCommand(writer: SmtpWriter, reader: SmtpReader, state: ResponseState, command: string, expected: number[], label = command.split(" ")[0]) {
  await withTimeout(writer.write(encoder.encode(`${command}\r\n`)), 15000, "SMTP 写入超时");
  const response = await readSmtpResponse(reader, state);
  if (!expected.includes(response.code)) {
    const detail = response.lines.map(line => line.replace(/^\d{3}[ -]/, "")).join("；").slice(0, 200);
    throw new Error(`SMTP ${label} 失败（${response.code}）：${detail}`);
  }
  return response;
}

async function sendSmtpMail(config: MailConfig, to: string, subject: string, html: string, text: string) {
  const preset = smtpPreset(config.from);
  const host = config.smtpHost?.trim() || preset.host;
  const port = Number(config.smtpPort) || preset.port;
  const security = config.smtpSecurity === "tls" || config.smtpSecurity === "starttls" ? config.smtpSecurity : (port === 465 || port === 994 ? "tls" : preset.security);
  if (port === 25) throw new Error("Cloudflare Workers 不允许连接 SMTP 25 端口，请改用 465 或 587");
  if (!host) throw new Error("无法确定 SMTP 服务器，请在后台填写 SMTP 主机");

  const socket = connect({ hostname: host, port }, { secureTransport: security === "tls" ? "on" : "starttls", allowHalfOpen: false });
  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  const state: ResponseState = { buffer: "" };

  try {
    await withTimeout(socket.opened, 10000, "SMTP 服务器连接超时");
    const greeting = await readSmtpResponse(reader, state);
    if (greeting.code !== 220) throw new Error(`SMTP 服务器拒绝连接（${greeting.code}）`);

    const heloDomain = config.from.split("@")[1] || "localhost";
    let ehlo = await smtpCommand(writer, reader, state, `EHLO ${heloDomain}`, [250], "EHLO");
    let capabilities = ehlo.lines.join("\n").toUpperCase();

    if (security === "starttls") {
      if (!capabilities.includes("STARTTLS")) throw new Error("SMTP 服务器不支持 STARTTLS，请改用 465 端口或 TLS 模式");
      await smtpCommand(writer, reader, state, "STARTTLS", [220], "STARTTLS");
      reader.releaseLock(); writer.releaseLock();
      const secureSocket = socket.startTls();
      await withTimeout(secureSocket.opened, 10000, "SMTP TLS 升级超时");
      reader = secureSocket.readable.getReader();
      writer = secureSocket.writable.getWriter();
      state.buffer = "";
      ehlo = await smtpCommand(writer, reader, state, `EHLO ${heloDomain}`, [250], "EHLO");
      capabilities = ehlo.lines.join("\n").toUpperCase();
    }

    const authLine = ehlo.lines.find(line => /^250[- ]AUTH\s/i.test(line)) || "";
    const methods = authLine.replace(/^250[- ]AUTH\s+/i, "").toUpperCase();
    if (methods.includes("LOGIN") || !methods) {
      await smtpCommand(writer, reader, state, "AUTH LOGIN", [334], "AUTH LOGIN");
      await smtpCommand(writer, reader, state, base64Utf8(config.from), [334], "用户名");
      await smtpCommand(writer, reader, state, base64Utf8(config.apiKey), [235], "授权码");
    } else if (methods.includes("PLAIN")) {
      await smtpCommand(writer, reader, state, `AUTH PLAIN ${base64Utf8(`\u0000${config.from}\u0000${config.apiKey}`)}`, [235], "AUTH PLAIN");
    } else {
      throw new Error("SMTP 服务器不支持 LOGIN/PLAIN 认证");
    }

    await smtpCommand(writer, reader, state, `MAIL FROM:<${config.from}>`, [250], "MAIL FROM");
    await smtpCommand(writer, reader, state, `RCPT TO:<${to}>`, [250, 251], "RCPT TO");
    await smtpCommand(writer, reader, state, "DATA", [354], "DATA");
    const message = dotStuff(buildMime(config, to, subject, html, text));
    await withTimeout(writer.write(encoder.encode(`${message}\r\n.\r\n`)), 15000, "SMTP 邮件写入超时");
    const sent = await readSmtpResponse(reader, state);
    if (sent.code !== 250) {
      const detail = sent.lines.map(line => line.replace(/^\d{3}[ -]/, "")).join("；").slice(0, 200);
      throw new Error(`SMTP 发送邮件内容失败（${sent.code}）：${detail}`);
    }
    try { await smtpCommand(writer, reader, state, "QUIT", [221], "QUIT"); } catch { /* 发送成功后忽略退出错误 */ }
  } finally {
    try { writer.close(); } catch { /* 忽略已关闭的连接 */ }
    try { socket.close(); } catch { /* 忽略已关闭的连接 */ }
  }
}

export function verificationHtml(code: string) {
  return `<div style="font-family:-apple-system,'Segoe UI','PingFang SC',sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f7f9fc;border-radius:16px">
  <h2 style="margin:0 0 8px;color:#0f172a">Ziheng API 邮箱验证码</h2>
  <p style="color:#475569;line-height:1.7">你正在注册 Ziheng API 账号，请在注册页面输入以下验证码：</p>
  <div style="font-size:34px;letter-spacing:10px;font-weight:700;color:#0e7490;background:#fff;border:1px solid #dbe4ee;border-radius:12px;padding:18px 0;text-align:center;margin:20px 0">${code}</div>
  <p style="color:#64748b;font-size:13px;line-height:1.7">验证码 10 分钟内有效，仅可使用一次。<br>如果这不是你的操作，请忽略本邮件。</p>
</div>`;
}

export async function logMail(env: Bindings, email: string, purpose: string, status: string, message = "") {
  await run(env.DB, "INSERT INTO mail_logs(id,email,purpose,status,message) VALUES(?,?,?,?,?)", [id(), email, purpose, status, message.slice(0, 300)]);
}
