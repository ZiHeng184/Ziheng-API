type ContentPart = { type: string; text?: string; image_url?: { url: string }; [key: string]: unknown };
type Message = { role: string; content?: string | ContentPart[] | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string; name?: string };

function claudeContent(content: Message["content"]) {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.map(part => {
    if (part.type === "text") return { type: "text", text: part.text || "" };
    if (part.type === "image_url" && part.image_url?.url) {
      const url = part.image_url.url;
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      return match ? { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } }
        : { type: "image", source: { type: "url", url } };
    }
    return part;
  });
}

export function openAiToClaude(body: Record<string, unknown>, model: string) {
  const messages = (body.messages || []) as Message[];
  const system = messages.filter(m => m.role === "system").map(m => typeof m.content === "string" ? m.content : "").join("\n\n");
  const converted = messages.filter(m => m.role !== "system").map(message => {
    if (message.role === "tool") return { role: "user", content: [{ type: "tool_result", tool_use_id: message.tool_call_id, content: message.content || "" }] };
    if (message.tool_calls?.length) return { role: "assistant", content: message.tool_calls.map(call => ({
      type: "tool_use", id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments || "{}")
    })) };
    return { role: message.role === "assistant" ? "assistant" : "user", content: claudeContent(message.content) };
  });
  const tools = Array.isArray(body.tools) ? (body.tools as { type: string; function: { name: string; description?: string; parameters?: unknown } }[])
    .filter(tool => tool.type === "function").map(tool => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters || { type: "object", properties: {} } })) : undefined;
  return {
    model, messages: converted, system: system || undefined, max_tokens: body.max_tokens || body.max_completion_tokens || 4096,
    temperature: body.temperature, top_p: body.top_p, stop: body.stop, stream: !!body.stream, tools,
    tool_choice: body.tool_choice === "auto" ? { type: "auto" } : body.tool_choice === "none" ? undefined :
      typeof body.tool_choice === "object" ? { type: "tool", name: (body.tool_choice as { function?: { name?: string } }).function?.name } : undefined
  };
}

export function claudeToOpenAi(data: Record<string, unknown>, requestedModel: string) {
  const content = Array.isArray(data.content) ? data.content as { type: string; text?: string; id?: string; name?: string; input?: unknown }[] : [];
  const text = content.filter(part => part.type === "text").map(part => part.text || "").join("");
  const tools = content.filter(part => part.type === "tool_use");
  const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  return {
    id: String(data.id || `chatcmpl-${crypto.randomUUID()}`).replace(/^msg_/, "chatcmpl-"), object: "chat.completion", created: Math.floor(Date.now() / 1000), model: requestedModel,
    choices: [{ index: 0, message: { role: "assistant", content: text || null, tool_calls: tools.length ? tools.map(tool => ({
      id: tool.id, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.input || {}) }
    })) : undefined }, finish_reason: tools.length ? "tool_calls" : data.stop_reason === "max_tokens" ? "length" : "stop" }],
    usage: { prompt_tokens: usage?.input_tokens || 0, completion_tokens: usage?.output_tokens || 0, total_tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0) }
  };
}

function sse(event: string, data: unknown) { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }

export function claudeStreamToOpenAi(stream: ReadableStream<Uint8Array>, requestedModel: string): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  const decoder = new TextDecoder(); const encoder = new TextEncoder();
  let buffer = ""; let completed = false; let messageId = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const blocks = new Map<number, { type: string; callId?: string; name?: string }>();
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ id: messageId, object: "chat.completion.chunk", created, model: requestedModel,
    choices: [{ index: 0, delta, finish_reason: finish }] });
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        if (!completed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({}, "stop"))}\n\ndata: [DONE]\n\n`));
        controller.close(); return;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n"); buffer = frames.pop() || "";
      for (const frame of frames) {
        const dataLine = frame.split("\n").find(line => line.startsWith("data:"));
        if (!dataLine) continue;
        try {
          const data = JSON.parse(dataLine.slice(5).trim());
          if (data.type === "message_start") {
            messageId = String(data.message?.id || messageId).replace(/^msg_/, "chatcmpl-");
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ role: "assistant", content: "" }))}\n\n`));
          } else if (data.type === "content_block_start") {
            const block = data.content_block || {}; blocks.set(data.index, { type: block.type, callId: block.id, name: block.name });
            if (block.type === "tool_use") controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ tool_calls: [{ index: data.index, id: block.id, type: "function", function: { name: block.name, arguments: "" } }] }))}\n\n`));
          } else if (data.type === "content_block_delta") {
            const delta = data.delta || {};
            if (delta.type === "text_delta") controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ content: delta.text }))}\n\n`));
            if (delta.type === "input_json_delta") controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ tool_calls: [{ index: data.index, function: { arguments: delta.partial_json } }] }))}\n\n`));
          } else if (data.type === "message_delta") {
            const finish = data.delta?.stop_reason === "tool_use" ? "tool_calls" : data.delta?.stop_reason === "max_tokens" ? "length" : "stop";
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({}, finish))}\n\n`));
            if (data.usage) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...chunk({}), usage: { prompt_tokens: 0, completion_tokens: data.usage.output_tokens || 0, total_tokens: data.usage.output_tokens || 0 } })}\n\n`));
          } else if (data.type === "message_stop") {
            completed = true; controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } else if (data.type === "error") controller.enqueue(encoder.encode(sse("error", data)));
        } catch { /* Ignore incomplete provider frames. */ }
      }
    },
    async cancel(reason) { await reader.cancel(reason); }
  });
}
