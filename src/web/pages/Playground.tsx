import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, CircleStop, Copy, Image, KeyRound, Play, RotateCcw, Send, ShieldCheck, Wrench } from "lucide-react";
import { api } from "../api";
import { Badge, Button, Field, Input, PageHeader, Select } from "../components/UI";
import type { Catalog } from "../types";

const tinyImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=";

export default function Playground({ toast, demoMode, scope = "admin", presetModel }: {
  toast: (message: string, type?: "success" | "error") => void;
  demoMode: boolean; scope?: "admin" | "me"; presetModel?: string;
}) {
  const isUser = scope === "me";
  const [apiKey, setApiKey] = useState(demoMode ? "zh-sk-ziheng-demo-2026" : "");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState(presetModel || localStorage.getItem("ziheng-playground-model") || "auto");
  const [prompt, setPrompt] = useState("你好，请介绍一下你自己。");
  const [stream, setStream] = useState(true);
  const [mode, setMode] = useState<"chat" | "tools" | "vision">("chat");
  const [output, setOutput] = useState(""); const [running, setRunning] = useState(false); const [meta, setMeta] = useState("");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { if (presetModel) { setModel(presetModel); localStorage.setItem("ziheng-playground-model", presetModel); } }, [presetModel]);

  const loadModels = async () => {
    try {
      if (isUser) {
        const catalog = await api<Catalog>("/api/me/catalog");
        const names = [...catalog.routes.map(r => r.name), ...catalog.models.filter(m => m.visible && m.status === "available").map(m => m.name)];
        setModels(names);
      } else {
        const response = await fetch("/v1/models", { headers: { Authorization: `Bearer ${apiKey}`, "x-ziheng-api-key": apiKey } });
        const data = await response.json<any>();
        if (!response.ok) throw new Error(data.error?.message || "加载模型失败");
        setModels(data.data.map((item: { id: string }) => item.id));
      }
    } catch (e) { toast(e instanceof Error ? e.message : "模型加载失败", "error"); }
  };
  useEffect(() => { if (!isUser && apiKey) loadModels(); else if (isUser) loadModels(); }, []);

  const run = async () => {
    if ((!isUser && !apiKey) || !prompt) return toast(isUser ? "请填写消息" : "请填写 API Key 和消息", "error");
    setRunning(true); setOutput(""); setMeta(""); abort.current = new AbortController();
    const content = mode === "vision" ? [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: tinyImage } }] : prompt;
    const tools = mode === "tools" ? [{ type: "function", function: { name: "get_weather", description: "查询天气", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }] : undefined;
    const payload = JSON.stringify({ model, messages: [{ role: "user", content }], stream, tools });
    try {
      const url = isUser ? "/api/me/playground/chat" : "/v1/chat/completions";
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (!isUser) { headers.Authorization = `Bearer ${apiKey}`; headers["x-ziheng-api-key"] = apiKey; }
      const response = await fetch(url, { method: "POST", headers, signal: abort.current.signal, body: payload });
      const decodeHeader = (value: string | null, fallback: string) => { try { return value ? decodeURIComponent(value) : fallback; } catch { return value || fallback; } };
      setMeta(`${response.status} · ${decodeHeader(response.headers.get("x-ziheng-provider"), "未命中渠道")} · ${decodeHeader(response.headers.get("x-ziheng-model"), model)} · 尝试 ${response.headers.get("x-ziheng-attempts") || 0} 次`);
      if (!response.ok) { const data = await response.json<any>(); throw new Error(data.error?.message || data.error || `HTTP ${response.status}`); }
      if (stream) {
        const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const frames = buffer.split("\n\n"); buffer = frames.pop() || "";
          for (const frame of frames) { const line = frame.split("\n").find(item => item.startsWith("data:")); if (!line || line.includes("[DONE]")) continue; try { const data = JSON.parse(line.slice(5)); const delta = data.choices?.[0]?.delta; if (delta?.content) setOutput(previous => previous + delta.content); if (delta?.tool_calls) setOutput(previous => previous + `\n工具调用：${JSON.stringify(delta.tool_calls, null, 2)}`); } catch {} }
        }
      } else { const data = await response.json<any>(); const message = data.choices?.[0]?.message; setOutput(message?.tool_calls ? `工具调用：\n${JSON.stringify(message.tool_calls, null, 2)}` : message?.content || JSON.stringify(data, null, 2)); }
    } catch (e) { if ((e as Error).name !== "AbortError") { setOutput(previous => `${previous}\n\n请求失败：${e instanceof Error ? e.message : "未知错误"}`); toast("请求失败，请查看输出", "error"); } }
    finally { setRunning(false); abort.current = null; }
  };

  return <><PageHeader eyebrow="PLAYGROUND" title="在线调试" description={isUser ? "使用你的内置默认密钥，通过真实中转链路验证模型（含每月免费额度与防滥用限制）。" : demoMode ? "通过真实 /v1/chat/completions 流程验证路由、流式、工具和图片请求。演示环境仅使用模拟上游。" : "通过真实 /v1/chat/completions 流程验证路由、流式、工具和图片请求。"} />
    <div className="playground-layout"><section className="panel playground-controls">
      {isUser ? <div className="playground-section"><div className="section-label"><ShieldCheck size={15}/> 访问凭据</div><div className="playground-key-note"><ShieldCheck size={16}/><div><strong>已启用内置默认密钥</strong><small>由系统自动创建，不可删除；调试请求计入你的每月免费额度</small></div></div></div>
        : <div className="playground-section"><div className="section-label"><KeyRound size={15}/> 访问凭据</div><div className="playground-key"><Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="zh-sk-…"/><Button variant="secondary" size="sm" onClick={loadModels}>加载模型</Button></div></div>}
      <div className="playground-section"><div className="section-label"><Bot size={15}/> 请求配置</div><Field label="模型或命名路由"><Select value={model} onChange={e => { setModel(e.target.value); localStorage.setItem("ziheng-playground-model", e.target.value); }}><option value={model}>{model}</option>{models.filter(name => name !== model).map(name => <option key={name}>{name}</option>)}</Select></Field><div className="mode-tabs"><button className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}><Send size={14}/> 聊天</button><button className={mode === "tools" ? "active" : ""} onClick={() => { setMode("tools"); setPrompt("请用工具查询上海天气"); }}><Wrench size={14}/> 工具</button><button className={mode === "vision" ? "active" : ""} onClick={() => { setMode("vision"); setPrompt("请描述这张测试图片"); }}><Image size={14}/> 图片</button></div><div className="stream-setting"><span><strong>流式输出</strong><small>Server-Sent Events</small></span><button className={`toggle ${stream ? "is-on" : ""}`} role="switch" aria-checked={stream} onClick={() => setStream(!stream)}><span/></button></div></div>
      <div className="playground-section prompt-section"><div className="section-label"><Send size={15}/> 用户消息</div><textarea className="input playground-prompt" rows={7} value={prompt} onChange={e => setPrompt(e.target.value)} /><div className="prompt-presets"><button onClick={() => { setModel("auto"); setPrompt("请让首选模型失败并观察自动降级"); }}>自动降级示例</button><button onClick={() => { setPrompt("你好，请介绍一下你自己。"); }}>重置示例</button></div></div>
      <div className="playground-actions">{running ? <Button variant="danger" onClick={() => abort.current?.abort()}><CircleStop size={16}/> 停止请求</Button> : <Button onClick={run}><Play size={16}/> 发送请求</Button>}<Button variant="secondary" onClick={() => { setOutput(""); setMeta(""); }}><RotateCcw size={16}/> 清空</Button></div>
    </section>
    <section className="panel response-panel"><header className="panel-header"><div><h2>模型响应</h2><p>OpenAI Chat Completions 格式</p></div>{output && <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(output); toast("响应已复制"); }}><Copy size={14}/> 复制</Button>}</header>{meta && <div className="response-meta"><Badge tone={meta.startsWith("200") ? "success" : "danger"}>{meta}</Badge></div>}<div className={`response-output ${running ? "is-running" : ""}`}>{output ? <pre>{output}</pre> : <div className="response-empty"><span><Bot size={28}/></span><strong>准备就绪</strong><p>发送消息后，响应会实时显示在这里。</p><div><Check size={14}/> 请求将经由真实中转链路</div></div>}{running && <span className="typing-cursor"/>}</div><footer className="response-footer"><span className="live-dot"/> {isUser ? "POST /api/me/playground/chat" : "POST /v1/chat/completions"}</footer></section></div>
  </>;
}
