import { Hono } from "hono";
import type { AppEnv } from "./types";
import { id } from "./types";
import { bootstrap } from "./bootstrap";
import { login, logout, requireAdmin, requireAuth, sessionInfo } from "./auth";
import { admin } from "./admin";
import { me, publicAuth, userAdmin } from "./users";
import { proxy } from "./proxy";
import { mockChat } from "./proxy/mock";

const app = new Hono<AppEnv>();
let bootstrapPromise: Promise<void> | null = null;

app.use("*", async (c, next) => {
  c.set("requestId", id());
  if (c.req.path.startsWith("/api") || c.req.path.startsWith("/v1") || c.req.path.startsWith("/mock")) {
    if (!bootstrapPromise) bootstrapPromise = bootstrap(c.env).catch(error => { bootstrapPromise = null; throw error; });
    await bootstrapPromise;
  }
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "SAMEORIGIN");
  if (c.req.path.startsWith("/api")) c.header("Cache-Control", "no-store");
});

app.get("/health", c => c.json({ status: "ok", name: "Ziheng API" }));
app.get("/api/config", c => c.json({ success: true, data: { siteName: "Ziheng API", devLogin: c.env.ALLOW_DEV_LOGIN === "true", demoMode: c.env.DEMO_MODE === "true" } }));
app.post("/api/auth/login", login);
app.post("/api/auth/logout", logout);
app.get("/api/auth/session", sessionInfo);
app.route("/api/auth", publicAuth);
app.use("/api/me/*", requireAuth);
app.route("/api/me", me);
app.use("/api/admin/*", requireAdmin);
app.route("/api/admin", userAdmin);
app.route("/api/admin", admin);
app.route("/v1", proxy);

app.post("/mock/v1/chat/completions", async c => {
  if (c.env.DEMO_MODE !== "true") return c.notFound();
  const body = await c.req.json<Record<string, unknown>>();
  return mockChat(body, String(body.model || "ziheng-flash"));
});
app.get("/mock/v1/models", c => c.env.DEMO_MODE === "true" ? c.json({ object: "list", data: ["ziheng-flash", "ziheng-pro", "ziheng-vision"].map(name => ({ id: name, object: "model" })) }) : c.notFound());

app.onError((error, c) => {
  console.error(`[${c.get("requestId")}]`, error);
  return c.json({ success: false, error: { message: "服务器内部错误", requestId: c.get("requestId") } }, 500);
});

export default app;
