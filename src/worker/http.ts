import type { Context } from "hono";
import type { AppEnv } from "./types";

export function ok<T>(c: Context<AppEnv>, data: T, status = 200) {
  return c.json({ success: true, data }, status as never);
}

export function fail(c: Context<AppEnv>, message: string, status = 400, details?: unknown) {
  return c.json({ success: false, error: { message, details } }, status as never);
}

export function clientIp(c: Context<AppEnv>) {
  return c.req.header("CF-Connecting-IP") || c.req.header("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";
}

export function openAiError(message: string, status = 400, type = "invalid_request_error") {
  return Response.json({ error: { message, type, param: null, code: null } }, { status });
}

export function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "未知错误";
}
