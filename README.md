# Ziheng-API
此工具目前只支持中文
> 部署在 **Cloudflare Workers** 上的个人 AI 中转站：无服务器、OpenAI 兼容接口、完整管理后台、服务端强制登录、多上游多 Key 自动降级、邀请码注册、邮箱验证码、免费额度与防滥用限流。

> [!NOTE]
> **本项目由 AI 生成与辅助开发：Kimi-3.1-Pro and Hy4。**
> 从需求澄清、架构设计、编码实现到调试部署，全流程人机协作完成，详见 [AI 生成说明](#ai-生成说明)。

---

## 目录

- [特性](#特性)
- [技术栈](#技术栈)
- [架构概览](#架构概览)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [数据库迁移](#数据库迁移)
- [API 使用](#api-使用)
- [管理后台](#管理后台)
- [权限与额度](#权限与额度)
- [安全说明](#安全说明)
- [目录结构](#目录结构)
- [AI 生成说明](#ai-生成说明)
- [许可证](#许可证)

---

## 特性

### 中转代理

- **OpenAI 兼容接口**：`/v1/chat/completions`、`/v1/models`，可直接被主流客户端 SDK 调用。
- **多上游协议**：OpenAI / Anthropic Claude 协议互转，工具调用（tools）与图片输入（vision）透传。
- **流式输出**：完整 SSE 支持，含末尾 usage 统计。
- **自动降级**：可按模型精确指定渠道，也可配置 `auto` 路由跨模型降级；单渠道失败自动冷却并切换到下一个可用 Key / 模型。
- **`auto` 智能路由**：把多个模型编排成一条链，客户端填 `auto` 即按预设顺序降级（路由名与模型名均大小写不敏感）。链路成员与顺序可在后台「路由编排」自由调整。
- **输出上限钳制**：转发前自动把客户端过大的 `max_tokens` / `max_completion_tokens` / `max_new_tokens` 压到上限，避免上游 `max_model_len` 返回 400；支持全局与模型级两级配置。
- **匿名上游**：支持不携带认证头的免费匿名渠道（如 KILO 免费网关、Cloudflare Workers AI）。

### 账号与鉴权

- **服务端强制鉴权**：登录态存于 HttpOnly + Secure + SameSite Cookie，Session 哈希入库，非纯前端拦截。
- **邀请码注册**：注册须提供有效邀请码 + 邮箱验证码，验证码 120 秒重发间隔。
- **邮箱验证码**：支持 HTTP 邮件 API（Resend / Brevo / MailerSend）与**通用邮箱 SMTP**（邮箱地址 + 授权码，自动识别主流邮箱主机/端口，QQ、163、Gmail 等开箱即用）；授权码加密存储。
- **改密**：管理员与普通用户均可在设置页修改密码。

### 用户与额度

- **普通用户受限权限**：查看用量、创建普通 API Key、在线调试、查看模型广场、修改密码；默认 Key 不可删除。
- **Playground 默认密钥**：新用户注册自动生成内置 Key，仅供内部 Playground 调用。
- **模型广场**：展示模型能力、渠道健康度与可见范围，支持搜索与筛选、一键跳转调试。
- **每月免费额度**：新用户默认每月 300 次请求 / 60 万 Token（后台可调），次月自动重置。
- **模型可见性**：可设为「仅管理员 / 所有用户 / 指定用户」，开放给所有用户前须人工确认上游条款允许中转（ToS）。
- **每分钟防滥用**：普通用户按分钟累计 Token，超限返回 429，阈值与开关后台可配。

### 管理后台

- 渠道与密钥池管理、模型与可见性管理、路由与降级链编排。
- 邀请码管理、用户管理（查看/删除用户、单独调整额度、重置密码）。
- 系统设置：重试策略、免费额度与防滥用、**全局输出上限**、邮件服务、管理员改密。
- **创建 Key 后一次性展示完整明文**，提供复制按钮，关闭后不再可见。
- 用量统计与错误日志，便于排障。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Cloudflare Workers（Hono） |
| 语言 | TypeScript |
| 数据库 | Cloudflare D1（SQLite） |
| 前端 | React 19 + Vite |
| 构建 | pnpm + tsc + Vite |
| 部署 | Wrangler |
| 测试 | Vitest |

---

## 架构概览

```
浏览器 (React SPA)
   │  /api/*  (Session Cookie 鉴权)
   ▼
Cloudflare Worker (Hono)
   ├─ /api/auth/*   登录 / 注册 / 会话
   ├─ /api/me/*     普通用户接口 (requireAuth)
   ├─ /api/admin/*  管理接口 (requireAdmin)
   └─ /v1/*         OpenAI 兼容中转 (API Key 鉴权)
          │
          ├─ 转发前：按模型/全局上限钳制 max_tokens
          ├─ D1 数据库 (用户 / Key / 渠道 / 用量 / 日志)
          └─ 上游渠道 (OpenAI / Claude / KILO / Workers AI ...)
```

静态资源由 Workers Assets 托管，`not_found_handling` 设为 SPA，前端路由走 hash。

---

## 快速开始

### 前置条件

- Node.js 22+ 与 pnpm
- 一个 Cloudflare 账号（用于 D1 与 Workers）
- Wrangler 已登录（`npx wrangler login`）或已配置 `CLOUDFLARE_API_TOKEN`

### 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 配置本地环境变量
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars：设置 ADMIN_PASSWORD、KEY_ENCRYPTION_SECRET 等

# 3. 应用本地数据库迁移
pnpm db:migrate:local

# 4. 启动本地服务（Worker + 前端代理）
pnpm dev
```

本地默认开启 `ALLOW_DEV_LOGIN=true`，无需额外验证即可登录，便于开发调试。

### 生产部署

```bash
# 1. 创建 D1 数据库，并把 database_id 写入 wrangler.jsonc
npx wrangler d1 create ziheng-db

# 2. 设置生产密钥（Secret，不写入代码库）
printf '%s' '你的强随机管理员密码' | npx wrangler secret put ADMIN_PASSWORD
printf '%s' '至少32位随机字符串'   | npx wrangler secret put KEY_ENCRYPTION_SECRET

# 3. 在 wrangler.jsonc 的 vars 中配置 APP_ORIGIN
#    并确保 DEMO_MODE=false、ALLOW_DEV_LOGIN=false

# 4. 应用生产迁移并部署
pnpm db:migrate:remote
pnpm deploy
```

部署后访问 Worker 地址或绑定的自定义域名，`/health` 应返回 `{"status":"ok"}`。

---

## 环境变量

| 变量 | 类型 | 说明 |
|---|---|---|
| `ADMIN_USERNAME` | var | 初始管理员用户名（默认 `admin`） |
| `ADMIN_PASSWORD` | Secret | 管理员密码；生产环境必须设置强随机值 |
| `KEY_ENCRYPTION_SECRET` | Secret | 上游 Key / 邮件 API Key / SMTP 授权码的 AES-GCM 加密主密钥，至少 32 位随机字符 |
| `ALLOW_DEV_LOGIN` | var | 是否允许开发模式免验证登录；生产必须为 `false` |
| `DEMO_MODE` | var | 演示模式开关；生产为 `false` 时不显示演示标记与 mock 模型 |
| `APP_ORIGIN` | var | 应用对外域名，用于 Session Cookie 的安全属性 |
| `MAIL_PROVIDER` | var | 邮件服务商：`resend`、`brevo`、`mailersend` 或 `smtp` |
| `MAIL_FROM` | var | 发件邮箱地址；SMTP 模式下同时作为登录用户名 |
| `MAIL_FROM_NAME` | var | 发件人显示名称 |
| `MAIL_API_KEY` | Secret | HTTP 邮件 API Key，或 SMTP 邮箱授权码 |
| `MAIL_SMTP_HOST` | var | 自定义 SMTP 主机；留空时按邮箱域名自动识别 |
| `MAIL_SMTP_PORT` | var | 自定义 SMTP 端口，常用 `465`（TLS）或 `587`（STARTTLS）；不支持 `25` |
| `MAIL_SMTP_SECURITY` | var | SMTP 加密方式：`auto`、`tls` 或 `starttls` |

> 邮件配置也可在后台「系统设置 → 邮件服务」中可视化维护，无需在部署时写死。生产环境切勿将 `ALLOW_DEV_LOGIN` 设为 `true`，也不要把任何 Secret 提交到代码库。

---

## 数据库迁移

迁移位于 `migrations/`，按顺序执行：

| 文件 | 内容 |
|---|---|
| `0001_init.sql` | 基础表：providers、provider_keys、models、routes、route_entries、api_tokens、sessions、settings、usage_daily、error_logs 等 |
| `0002_users.sql` | 普通用户、角色、邀请码、邮箱验证码、用户 Key 归属 |
| `0003_quota_visibility.sql` | 用户月度额度、月度用量、模型可见范围、ToS 确认 |
| `0004_abuse_policy.sql` | 每分钟防滥用统计表 |
| `0005_default_key.sql` | 用户默认 Playground 密钥标记 |
| `0006_output_cap.sql` | 模型级输出 Token 上限列（`max_output_tokens`，用于钳制 `max_tokens`） |

```bash
pnpm db:migrate:local    # 本地
pnpm db:migrate:remote   # 生产
```

> 生产升级时务必先应用迁移，再部署新版本 Worker，否则引用新列的查询会报错。

---

## API 使用

### 调用模型

```bash
curl https://你的域名/v1/chat/completions \
  -H "Authorization: Bearer <你的 API Key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

`model` 可为具体模型名，或路由名（如 `auto`）。流式请求传 `"stream": true`，返回标准 SSE 数据帧。路由名与模型名均大小写不敏感。

### 查看模型

```bash
curl https://你的域名/v1/models \
  -H "Authorization: Bearer <你的 API Key>"
```

返回的列表包含当前用户可见的模型，以及所有启用的命名路由（如 `auto`）。

### 网关代理兼容

若请求经代理导致 `Authorization` 头被改写，可用 `x-ziheng-api-key` 传递 Key：

```bash
curl https://你的域名/v1/models -H "x-ziheng-api-key: <你的 API Key>"
```

---

## 管理后台

登录后进入控制台，主要功能：

- **控制台**：总览请求量、Token 消耗与趋势。
- **渠道管理**：添加 / 编辑 Provider（协议、Base URL、优先级、超时），维护 Key 池（加密存储、失败冷却）。
- **模型管理**：配置模型名与上游名、能力开关、可见范围、ToS 确认与**单模型输出上限**。
- **路由编排**：把多个模型编排为降级链，决定 `auto` 等路由的切模型策略（可增删节点、调整顺序）。
- **API 密钥**：创建 / 编辑 Key，设置额度、并发、允许模型与 IP；**创建成功后一次性展示完整明文并支持复制**。
- **邀请码**：生成 / 停用邀请码，供注册使用。
- **用户管理**：查看全部用户、单独调整额度、删除用户、重置密码。
- **系统设置**：重试策略、免费额度与防滥用、**全局输出上限**、邮件服务、管理员改密。
- **错误日志**：查看失败请求与上游错误，便于排障。

### `auto` 路由怎么配

1. 在「路由编排」新建一条路由，名称填 `auto`（或任意别名）。
2. 按顺序添加模型节点：排在前面的优先尝试，失败后自动降级到下一个。
3. 客户端把 `model` 设为该名称即可。建议首个节点选「聪明且额度充裕」的模型。

### 创建 Key 后如何拿到明文

创建 Key 时会立即弹出完整明文 Key 与复制按钮，**关闭后无法再次查看**（服务端仅存哈希）。若当时未保存，请删除该 Key 后重新创建。

---

## 权限与额度

| 角色 | 能力 |
|---|---|
| 管理员 | 全部后台功能；不受模型可见性与额度/限流限制 |
| 普通用户 | 查看用量、创建普通 Key、在线调试、查看模型广场、修改密码 |

- **默认免费额度**：每月 300 次请求 / 60 万 Token，注册时写入，可在后台按用户调整或设为不限。
- **防滥用限流**：默认每分钟 1.2 万 Token，超限返回 429；管理员 Key 不受限。
- **输出上限**：全局默认 24000 Token，模型级可覆盖；转发前自动钳制过大的 `max_tokens`。
- **默认密钥**：普通用户注册自动生成，用于内部 Playground，不可删除、停用或改权限。

---

## 安全说明

- 用户密码使用 **PBKDF2-SHA256 加盐哈希**（10 万次迭代）存储，永不明文。
- 下游 API Key 仅存 **SHA-256 哈希**，完整明文只在创建时展示一次。
- 上游 API Key、邮件 API Key 与 SMTP 邮箱授权码使用 **AES-GCM** 加密存储（主密钥为 `KEY_ENCRYPTION_SECRET`）。
- 登录态为服务端 Session，Cookie 设置 HttpOnly / Secure / SameSite，Session 哈希入库。
- 模型开放给所有用户前，管理员须人工确认上游服务条款允许中转（ToS 开关）。
- 用户永久存储于 D1，仅在管理员手动删除时移除。

---

## 目录结构

```
ziheng-api/
├── migrations/              # D1 数据库迁移
├── scripts/                 # 辅助脚本（本地预览服务等）
├── src/
│   ├── worker/              # 后端（Cloudflare Worker / Hono）
│   │   ├── proxy/           # 中转核心：路由、降级、钳制、协议转换、mock
│   │   ├── admin.ts         # 管理接口
│   │   ├── users.ts         # 普通用户接口
│   │   ├── auth.ts          # 登录 / Session / 限流
│   │   ├── crypto.ts        # 密码哈希与密钥加解密
│   │   ├── db.ts            # 数据访问与用量统计
│   │   ├── mail.ts          # 邮件验证码（HTTP API / SMTP）
│   │   └── index.ts         # 应用入口与路由挂载
│   └── web/                 # 前端（React + Vite）
│       ├── pages/           # 各功能页面
│       ├── components/      # 通用 UI 组件
│       └── api.ts           # 前端 API 封装
├── tests/                   # 单元测试（Vitest）
├── package.json
├── vite.config.ts
├── wrangler.jsonc           # Worker / D1 / vars 配置
└── README.md
```

---

## AI 生成说明

本项目由 AI 模型 **Kimi-3.1-Pro** 与 **Hy4** 生成与辅助开发，覆盖需求梳理、架构设计、后端与前端实现、协议转换、部署配置、问题排查与文档撰写等环节。所有生成内容均经过人工审阅、测试与真实环境部署验证。

---

## 许可证

本项目当前**未指定开源许可证**。在未明确授权前，请勿将其用于商业分发；如需使用、修改或再发布，请联系项目所有者确认授权条款。
