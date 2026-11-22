import { describe, expect, it } from "vitest";
import { claudeToOpenAi, openAiToClaude } from "../src/worker/proxy/converters";
import { mockChat } from "../src/worker/proxy/mock";
import { hashPassword, verifyPassword, encryptSecret, decryptSecret } from "../src/worker/crypto";

describe("OpenAI 与 Claude 协议转换", () => {
  it("转换 system、图片与工具定义", () => {
    const result = openAiToClaude({ messages: [
      { role: "system", content: "保持简洁" },
      { role: "user", content: [{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }
    ], tools: [{ type: "function", function: { name: "weather", parameters: { type: "object" } } }] }, "claude-test");
    expect(result.system).toBe("保持简洁");
    expect(result.messages).toHaveLength(1);
    expect(result.tools?.[0].name).toBe("weather");
    expect(JSON.stringify(result.messages[0])).toContain("base64");
  });

  it("将 Claude 文本和工具响应转换为 OpenAI", () => {
    const result = claudeToOpenAi({ id: "msg_1", content: [{ type: "text", text: "你好" }, { type: "tool_use", id: "tool_1", name: "weather", input: { city: "上海" } }], usage: { input_tokens: 5, output_tokens: 7 } }, "claude-test");
    expect(result.choices[0].message.content).toBe("你好");
    expect(result.choices[0].message.tool_calls?.[0].function.name).toBe("weather");
    expect(result.usage.total_tokens).toBe(12);
  });
});

describe("模拟上游", () => {
  it("支持非流式响应与用量", async () => {
    const response = mockChat({ model: "ziheng-flash", messages: [{ role: "user", content: "你好" }] }, "ziheng-flash");
    const data = await response.json<any>();
    expect(response.status).toBe(200);
    expect(data.choices[0].message.content).toContain("模拟回复");
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  });
  it("在指定场景返回 429 供降级测试", async () => {
    const response = mockChat({ messages: [{ role: "user", content: "演示降级" }] }, "ziheng-pro");
    expect(response.status).toBe(429);
  });
  it("输出 OpenAI SSE 流", async () => {
    const response = mockChat({ messages: [{ role: "user", content: "你好" }], stream: true }, "ziheng-flash");
    const text = await response.text();
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("data: [DONE]");
  });
});

describe("凭据保护", () => {
  it("PBKDF2 密码可验证且错误密码被拒绝", async () => {
    const { salt, hash } = await hashPassword("a-secure-password", "test-salt");
    expect(await verifyPassword("a-secure-password", salt, hash)).toBe(true);
    expect(await verifyPassword("wrong", salt, hash)).toBe(false);
  });
  it("AES-GCM 加密上游 Key 并可还原", async () => {
    const encrypted = await encryptSecret("sk-secret", "encryption-secret");
    expect(encrypted).not.toContain("sk-secret");
    expect(await decryptSecret(encrypted, "encryption-secret")).toBe("sk-secret");
  });
});
