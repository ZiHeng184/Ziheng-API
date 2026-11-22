function latestText(body: { messages?: { content?: unknown }[] }) {
  const messages = body.messages || [];
  const content = messages[messages.length - 1]?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part: { type?: string; text?: string }) => part.type === "text" ? part.text : "").join(" ");
  return "";
}

function chunk(model: string, delta: Record<string, unknown>, finish: string | null = null, usage?: unknown) {
  return { id: `chatcmpl-mock-${crypto.randomUUID()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta, finish_reason: finish }], usage };
}

export function mockChat(body: Record<string, unknown>, upstreamModel: string): Response {
  const prompt = latestText(body as { messages?: { content?: unknown }[] });
  if (prompt.includes("[失败]") || (prompt.includes("演示降级") && upstreamModel === "ziheng-pro")) {
    return Response.json({ error: { message: "模拟渠道额度耗尽，请切换下一项", type: "rate_limit_error" } }, { status: 429, headers: { "retry-after": "1" } });
  }
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const wantsTool = hasTools && /天气|工具|weather/i.test(prompt);
  const text = wantsTool ? "" : `我是 ${upstreamModel} 的模拟回复。已收到你的消息：「${prompt || "你好"}」。\n\n当前请求经过 Ziheng API 的统一 OpenAI 接口；此环境不会调用任何真实上游。`;
  const responseId = `chatcmpl-mock-${crypto.randomUUID()}`;
  if (body.stream) {
    const encoder = new TextEncoder();
    const events = wantsTool ? [
      chunk(upstreamModel, { role: "assistant", content: "" }),
      chunk(upstreamModel, { tool_calls: [{ index: 0, id: `call_${crypto.randomUUID()}`, type: "function", function: { name: "get_weather", arguments: "{\"city\":\"上海\"}" } }] }, "tool_calls")
    ] : [chunk(upstreamModel, { role: "assistant", content: "" }), ...Array.from(text).map(char => chunk(upstreamModel, { content: char })), chunk(upstreamModel, {}, "stop")];
    events.push(chunk(upstreamModel, {}, null, { prompt_tokens: 16, completion_tokens: Math.max(8, Math.ceil(text.length / 2)), total_tokens: 16 + Math.max(8, Math.ceil(text.length / 2)) }));
    let index = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (index < events.length) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(events[index++])}\n\n`));
        } else { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); }
      }
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
  }
  return Response.json({
    id: responseId, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: upstreamModel,
    choices: [{ index: 0, message: { role: "assistant", content: wantsTool ? null : text, tool_calls: wantsTool ? [{ id: `call_${crypto.randomUUID()}`, type: "function", function: { name: "get_weather", arguments: "{\"city\":\"上海\"}" } }] : undefined }, finish_reason: wantsTool ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 16, completion_tokens: Math.max(8, Math.ceil(text.length / 2)), total_tokens: 16 + Math.max(8, Math.ceil(text.length / 2)) }
  });
}
