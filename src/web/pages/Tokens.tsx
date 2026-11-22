import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { api, del, formatDate, formatNumber, patch, post } from "../api";
import type { ApiToken } from "../types";
import { Badge, Button, Field, IconButton, Input, Modal, PageHeader, Toggle } from "../components/UI";

type Notify = (message: string, type?: "success" | "error") => void;
const blank = { name: "", expires_at: "", allowed_models: "*", allowed_ips: "", request_limit: "", token_limit: "", concurrency_limit: "3" };

export default function Tokens({ toast, demoMode, scope = "admin" }: { toast: Notify; demoMode: boolean; scope?: "admin" | "me" }) {
  const base = scope === "me" ? "/api/me" : "/api/admin";
  const [tokens, setTokens] = useState<ApiToken[]>([]); const [editor, setEditor] = useState<ApiToken | "new" | null>(null); const [form, setForm] = useState<Record<string, string>>(blank);
  const [created, setCreated] = useState<{ id: string; name: string; token: string } | null>(null); const [copied, setCopied] = useState(""); const [saving, setSaving] = useState(false);
  const load = async () => { try { setTokens(await api<ApiToken[]>(`${base}/tokens`)); } catch (e) { toast(e instanceof Error ? e.message : "加载失败", "error"); } };
  useEffect(() => { load(); }, []);
  const copy = async (text: string, id = "created") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id); setTimeout(() => setCopied(""), 1800);
    } catch {
      toast("自动复制失败，请全选上方 Key 后手动复制", "error");
    }
  };
  const open = (item: ApiToken | "new") => { setEditor(item); setForm(item === "new" ? blank : { name: item.name, expires_at: item.expires_at ? new Date(item.expires_at).toISOString().slice(0, 16) : "", allowed_models: item.allowed_models.join(", "), allowed_ips: item.allowed_ips.join("\n"), request_limit: item.request_limit?.toString() || "", token_limit: item.token_limit?.toString() || "", concurrency_limit: item.concurrency_limit?.toString() || "" }); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const creating = editor === "new";
    const body = { name: form.name, expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null, allowed_models: form.allowed_models.split(/[,\s]+/).filter(Boolean), allowed_ips: form.allowed_ips.split(/[,\n\s]+/).filter(Boolean), request_limit: form.request_limit ? Number(form.request_limit) : null, token_limit: form.token_limit ? Number(form.token_limit) : null, concurrency_limit: form.concurrency_limit ? Number(form.concurrency_limit) : null };
    setSaving(true);
    try {
      if (creating) {
        const result = await post<{ id: string; token: string }>(`${base}/tokens`, body);
        if (!result?.token) throw new Error("Key 已创建，但接口没有返回明文，请刷新页面后检查 Key 列表");
        setCreated({ id: result.id, name: form.name.trim(), token: result.token });
      } else if (editor) await patch(`${base}/tokens/${editor.id}`, body);
      toast(creating ? "API Key 已创建，请立即复制" : "Key 配置已更新");
      setEditor(null);
      void load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };
  return <>
    <PageHeader eyebrow="ACCESS CONTROL" title={scope === "me" ? "我的 API 密钥" : "API 密钥"} description="为每个客户端创建独立 Key，精确控制模型、IP、额度和并发。" actions={<Button onClick={() => open("new")}><Plus size={16}/> 创建 API Key</Button>} />
    {demoMode && scope === "admin" && <div className="demo-key-banner"><KeyRound size={19}/><div><strong>公网演示 Key</strong><code>zh-sk-ziheng-demo-2026</code></div><Button variant="secondary" size="sm" onClick={() => copy("zh-sk-ziheng-demo-2026", "demo")}>{copied === "demo" ? <Check size={14}/> : <Copy size={14}/>} 复制</Button></div>}
    <section className="metric-grid token-metrics"><article className="metric-card"><span className="metric-simple-label">Key 总数</span><strong>{tokens.length}</strong><small>{tokens.filter(token => token.enabled).length} 个正在使用</small></article><article className="metric-card"><span className="metric-simple-label">活跃请求</span><strong>{tokens.reduce((sum, token) => sum + token.active_requests, 0)}</strong><small>全局并发占用</small></article><article className="metric-card"><span className="metric-simple-label">累计 Token</span><strong>{formatNumber(tokens.reduce((sum, token) => sum + token.used_tokens, 0))}</strong><small>输入与输出合计</small></article><article className="metric-card"><span className="metric-simple-label">权限策略</span><strong>4<em> 层</em></strong><small>模型 · IP · 额度 · 并发</small></article></section>
    <section className="panel table-panel"><div className="table-toolbar"><div><strong>访问凭据</strong><span className="toolbar-subtitle">完整 Key 仅在创建时显示一次</span></div></div><div className="table-scroll"><table><thead><tr><th>名称 / Key</th><th>权限范围</th><th>用量 / 额度</th><th>过期时间</th><th>状态</th><th className="align-right">操作</th></tr></thead><tbody>{tokens.map(token => <tr key={token.id}><td><div className="token-name"><strong>{token.name}</strong>{token.kind === "default" && <Badge tone="info">内置</Badge>}<code>{token.prefix}</code></div></td><td><div className="permission-cell"><span>{token.allowed_models.includes("*") ? "全部模型" : `${token.allowed_models.length} 个模型`}</span><small>{token.allowed_ips.length ? `${token.allowed_ips.length} 条 IP 规则` : "任意 IP"}{token.concurrency_limit ? ` · 并发 ${token.concurrency_limit}` : ""}</small></div></td><td><div className="usage-cell"><span>{formatNumber(token.used_requests)} / {token.request_limit || "∞"} 次</span><small>{formatNumber(token.used_tokens)} / {token.token_limit || "∞"} Tokens</small><div className="usage-progress"><i style={{ width: `${Math.min(100, token.request_limit ? token.used_requests / token.request_limit * 100 : 4)}%` }}/></div></div></td><td><span className="date-cell">{formatDate(token.expires_at)}</span></td><td><Badge tone={token.enabled ? "success" : "neutral"}>{token.enabled ? "已启用" : "已停用"}</Badge></td><td><div className="row-actions">{token.kind !== "default" && <Toggle checked={!!token.enabled} label="启用 Key" onChange={async enabled => { await patch(`${base}/tokens/${token.id}`, { enabled }); load(); }}/>}<IconButton label="编辑 Key" onClick={() => open(token)}><KeyRound size={16}/></IconButton><IconButton label="重置用量" onClick={async () => { if (confirm("确定将此 Key 的已用请求与 Token 归零？")) { await post(`${base}/tokens/${token.id}/reset`); toast("用量已重置"); load(); } }}><RotateCcw size={16}/></IconButton>{token.kind !== "default" && <IconButton label="删除 Key" onClick={async () => { if (confirm("删除后使用此 Key 的客户端将立即失效，确定继续？")) { await del(`${base}/tokens/${token.id}`); toast("Key 已删除"); load(); } }}><Trash2 size={16}/></IconButton>}</div></td></tr>)}</tbody></table></div></section>
    {editor && <Modal title={editor === "new" ? "创建 API Key" : `编辑 ${editor.name}`} description="留空额度字段表示不限制。模型权限可填写具体模型或路由名。" onClose={() => setEditor(null)} wide><form onSubmit={save} className="form-stack"><div className="form-grid"><Field label="Key 名称" required><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：Cherry Studio" required /></Field><Field label="过期时间" hint="留空表示永久有效"><Input type="datetime-local" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} /></Field></div><Field label="允许的模型或路由" hint="使用逗号分隔；* 表示全部。例如：auto, ziheng-flash"><Input value={form.allowed_models} onChange={e => setForm({ ...form, allowed_models: e.target.value })} placeholder="*" /></Field><Field label="IP 白名单" hint="每行一个 IP，支持 IPv4 CIDR；留空表示不限制"><textarea className="input textarea" rows={3} value={form.allowed_ips} onChange={e => setForm({ ...form, allowed_ips: e.target.value })} placeholder="203.0.113.8&#10;198.51.100.0/24" /></Field><div className="form-grid form-grid-three"><Field label="请求次数上限"><Input type="number" min="1" value={form.request_limit} onChange={e => setForm({ ...form, request_limit: e.target.value })} placeholder="不限" /></Field><Field label="Token 用量上限"><Input type="number" min="1" value={form.token_limit} onChange={e => setForm({ ...form, token_limit: e.target.value })} placeholder="不限" /></Field><Field label="最大并发数"><Input type="number" min="1" value={form.concurrency_limit} onChange={e => setForm({ ...form, concurrency_limit: e.target.value })} placeholder="不限" /></Field></div><div className="security-note"><ShieldCheck size={17}/> Key 仅以 SHA-256 哈希存储，服务端不会保留完整明文。</div><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setEditor(null)}>取消</Button><Button type="submit" loading={saving}><Check size={16}/> {editor === "new" ? "创建 Key" : "保存修改"}</Button></div></form></Modal>}
    {created && <Modal title="API Key 创建成功" description={`${created.name} · 完整 Key 仅此一次展示，关闭后无法找回。`} onClose={() => setCreated(null)}><div className="created-key"><label htmlFor="created-api-key">完整 API Key</label><div className="created-key-row"><Input id="created-api-key" type="text" readOnly autoFocus value={created.token} onFocus={event => event.currentTarget.select()} aria-label="完整 API Key"/><Button type="button" onClick={() => copy(created.token)}>{copied === "created" ? <Check size={16}/> : <Copy size={16}/>} {copied === "created" ? "已复制" : "复制 Key"}</Button></div><small>请粘贴到客户端的 API Key / 密钥字段。若自动复制失败，可点击输入框全选后手动复制。</small></div><div className="security-note"><ShieldCheck size={17}/> 服务端只保存 SHA-256 哈希；关闭此窗口后，只能重新创建新 Key。</div><div className="modal-actions"><Button onClick={() => setCreated(null)}>我已复制并保存</Button></div></Modal>}
  </>;
}
