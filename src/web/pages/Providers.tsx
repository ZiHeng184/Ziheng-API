import { useEffect, useState } from "react";
import { Boxes, Check, ChevronRight, CirclePlus, CloudDownload, KeyRound, MoreHorizontal, Pencil, PlugZap, Plus, RefreshCw, Search, Server, ShieldOff, Trash2, X } from "lucide-react";
import { api, del, formatDate, patch, post } from "../api";
import type { Model, Provider, ProviderKey } from "../types";
import { Badge, Button, Empty, Field, IconButton, Input, Modal, PageHeader, Select, Toggle } from "../components/UI";

type Notify = (message: string, type?: "success" | "error") => void;
const blank = { name: "", protocol: "openai", base_url: "", api_key: "", priority: 0, timeout_ms: 60000, enabled: true };

export default function Providers({ toast }: { toast: Notify }) {
  const [providers, setProviders] = useState<Provider[]>([]); const [loading, setLoading] = useState(true); const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Provider | "new" | null>(null); const [form, setForm] = useState<Record<string, unknown>>(blank); const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Provider | null>(null); const [tab, setTab] = useState<"models" | "keys">("models");
  const [models, setModels] = useState<Model[]>([]); const [keys, setKeys] = useState<ProviderKey[]>([]); const [testing, setTesting] = useState("");
  const [modelForm, setModelForm] = useState({ name: "", upstream_name: "", supports_tools: true, supports_vision: true }); const [newKey, setNewKey] = useState("");
  const [modelEdit, setModelEdit] = useState<Model | null>(null); const [usersForPick, setUsersForPick] = useState<{ id: string; username: string; role: string }[]>([]);
  const load = async () => { try { setProviders(await api<Provider[]>("/api/admin/providers")); } catch (e) { toast(e instanceof Error ? e.message : "加载失败", "error"); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const openEditor = (item: Provider | "new") => { setEditor(item); setForm(item === "new" ? blank : { ...item, api_key: "" }); };
  const save = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try {
    if (editor === "new") await post("/api/admin/providers", form); else if (editor) await patch(`/api/admin/providers/${editor.id}`, form);
    toast(editor === "new" ? "渠道已添加" : "渠道配置已保存"); setEditor(null); await load();
  } catch (e) { toast(e instanceof Error ? e.message : "保存失败", "error"); } finally { setSaving(false); } };
  const openDetail = async (provider: Provider, selectedTab: "models" | "keys" = "models") => {
    setDetail(provider); setTab(selectedTab); setNewKey("");
    const [modelData, keyData] = await Promise.all([api<Model[]>(`/api/admin/providers/${provider.id}/models`), api<ProviderKey[]>(`/api/admin/providers/${provider.id}/keys`)]);
    setModels(modelData); setKeys(keyData);
  };
  const refreshDetail = async () => { if (!detail) return; await openDetail(detail, tab); await load(); };
  const openModelEdit = async (model: Model) => { setModelEdit({ ...model }); try { setUsersForPick((await api<{ id: string; username: string; role: string }[]>("/api/admin/users")).filter(u => u.role === "user")); } catch {} };
  const test = async (provider: Provider) => { setTesting(provider.id); try { const result = await post<{ latency: number; message: string }>(`/api/admin/providers/${provider.id}/test`); toast(`${result.message} · ${result.latency}ms`); } catch (e) { toast(e instanceof Error ? e.message : "测试失败", "error"); } finally { setTesting(""); } };
  const discover = async () => { if (!detail) return; setSaving(true); try {
    const names = await post<string[]>(`/api/admin/providers/${detail.id}/discover`);
    for (const name of names) if (!models.some(model => model.name === name)) await post(`/api/admin/providers/${detail.id}/models`, { name, upstream_name: name });
    toast(`已同步 ${names.length} 个模型`); await refreshDetail();
  } catch (e) { toast(e instanceof Error ? e.message : "同步失败", "error"); } finally { setSaving(false); } };
  const filtered = providers.filter(provider => provider.name.toLowerCase().includes(search.toLowerCase()) || provider.base_url.toLowerCase().includes(search.toLowerCase()));
  return <>
    <PageHeader eyebrow="UPSTREAM" title="渠道管理" description="集中管理 OpenAI、Claude 与匿名上游，为每个渠道维护独立模型和密钥池。" actions={<Button onClick={() => openEditor("new")}><Plus size={16}/> 添加渠道</Button>} />
    <div className="info-strip"><ShieldOff size={17}/><span><strong>支持匿名接入：</strong>不添加 API Key 即可，匿名请求不会发送 Authorization 或 x-api-key。</span></div>
    <section className="panel table-panel"><div className="table-toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索渠道名称或地址…" /></div><span className="toolbar-count">共 {filtered.length} 个渠道</span><IconButton label="刷新" onClick={load}><RefreshCw size={16}/></IconButton></div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>渠道</th><th>协议 / 接口地址</th><th>资源</th><th>优先级</th><th>状态</th><th className="align-right">操作</th></tr></thead><tbody>{filtered.map(provider => <tr key={provider.id}>
        <td><div className="name-cell"><span className={`provider-logo ${provider.protocol}`}>{provider.protocol === "claude" ? "C" : "O"}</span><div><strong>{provider.name}</strong><small>添加于 {formatDate(provider.created_at, false)}</small></div></div></td>
        <td><div className="endpoint-cell"><Badge tone={provider.protocol === "claude" ? "purple" : "info"}>{provider.protocol === "claude" ? "Claude" : "OpenAI"}</Badge><code title={provider.base_url}>{provider.base_url}</code></div></td>
        <td><button className="resource-link" onClick={() => openDetail(provider)}>{provider.model_count} 模型 <span>·</span> {provider.key_count || "匿名"}{provider.key_count ? " Key" : ""}<ChevronRight size={14}/></button></td>
        <td><span className="priority">{provider.priority}</span></td><td><Badge tone={provider.enabled ? "success" : "neutral"}>{provider.enabled ? "已启用" : "已停用"}</Badge></td>
        <td><div className="row-actions"><IconButton label="测试连接" disabled={testing === provider.id} onClick={() => test(provider)}><PlugZap size={16} className={testing === provider.id ? "spin" : ""}/></IconButton><IconButton label="管理模型和密钥" onClick={() => openDetail(provider)}><Server size={16}/></IconButton><IconButton label="编辑渠道" onClick={() => openEditor(provider)}><Pencil size={16}/></IconButton><IconButton label="删除渠道" onClick={async () => { if (confirm(`确定删除「${provider.name}」及其模型、密钥吗？`)) { await del(`/api/admin/providers/${provider.id}`); toast("渠道已删除"); load(); } }}><Trash2 size={16}/></IconButton></div></td>
      </tr>)}</tbody></table></div> : <Empty icon={<Boxes size={28}/>} title="还没有上游渠道" description="添加一个 OpenAI 兼容或 Claude 渠道，开始构建你的统一接口。" action={<Button onClick={() => openEditor("new")}><Plus size={16}/> 添加第一个渠道</Button>} />}
    </section>
    {editor && <Modal title={editor === "new" ? "添加上游渠道" : "编辑渠道"} description="Base URL 可填写到域名或 /v1，系统会自动规范化。" onClose={() => setEditor(null)}><form onSubmit={save} className="form-stack">
      <div className="form-grid"><Field label="渠道名称" required><Input value={String(form.name || "")} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：我的 OpenAI" required /></Field><Field label="上游协议" required><Select value={String(form.protocol)} onChange={e => setForm({ ...form, protocol: e.target.value })}><option value="openai">OpenAI 兼容</option><option value="claude">Anthropic Claude</option></Select></Field></div>
      <Field label="Base URL" required hint="支持自定义网关；模拟验收可使用 mock://local"><Input value={String(form.base_url || "")} onChange={e => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.openai.com/v1" required /></Field>
      {editor === "new" && <Field label="初始 API Key" hint="匿名上游请留空。保存后可在密钥池中添加更多 Key。"><Input type="password" value={String(form.api_key || "")} onChange={e => setForm({ ...form, api_key: e.target.value })} placeholder="sk-…（可留空）" autoComplete="off" /></Field>}
      <div className="form-grid"><Field label="优先级" hint="数字越大，同模型渠道越优先"><Input type="number" value={Number(form.priority || 0)} onChange={e => setForm({ ...form, priority: Number(e.target.value) })} /></Field><Field label="上游超时（毫秒）"><Input type="number" min={1000} max={300000} value={Number(form.timeout_ms || 60000)} onChange={e => setForm({ ...form, timeout_ms: Number(e.target.value) })} /></Field></div>
      <div className="switch-row"><div><strong>启用此渠道</strong><small>停用后不会参与任何请求调度</small></div><Toggle checked={!!form.enabled} onChange={enabled => setForm({ ...form, enabled })} label="启用渠道" /></div>
      <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setEditor(null)}>取消</Button><Button loading={saving} type="submit"><Check size={16}/> 保存渠道</Button></div>
    </form></Modal>}
    {detail && <Modal title={detail.name} description="模型映射与上游凭据仅管理员可见。" onClose={() => setDetail(null)} wide><div className="detail-summary"><div><span className={`provider-logo ${detail.protocol}`}>{detail.protocol === "claude" ? "C" : "O"}</span><div><strong>{detail.base_url}</strong><small>{detail.protocol === "claude" ? "Anthropic Messages API" : "OpenAI Chat Completions API"}</small></div></div><Button variant="secondary" size="sm" loading={testing === detail.id} onClick={() => test(detail)}><PlugZap size={15}/> 测试连接</Button></div>
      <div className="tabs"><button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}><Boxes size={16}/> 模型管理 <span>{models.length}</span></button><button className={tab === "keys" ? "active" : ""} onClick={() => setTab("keys")}><KeyRound size={16}/> 密钥池 <span>{keys.length}</span></button></div>
      {tab === "models" ? <div className="detail-section"><div className="inline-create"><Input placeholder="对外模型名，如 gpt-4o-mini" value={modelForm.name} onChange={e => setModelForm({ ...modelForm, name: e.target.value })}/><Input placeholder="上游模型名（默认同名）" value={modelForm.upstream_name} onChange={e => setModelForm({ ...modelForm, upstream_name: e.target.value })}/><Button onClick={async () => { if (!modelForm.name) return; try { await post(`/api/admin/providers/${detail.id}/models`, modelForm); setModelForm({ name: "", upstream_name: "", supports_tools: true, supports_vision: true }); toast("模型已添加"); refreshDetail(); } catch (e) { toast(e instanceof Error ? e.message : "添加失败", "error"); } }}><Plus size={15}/> 添加</Button></div>
        <div className="detail-toolbar"><span>支持自动拉取，也可手动维护无法列出模型的匿名渠道</span><Button variant="ghost" size="sm" loading={saving} onClick={discover}><CloudDownload size={15}/> 拉取并同步</Button></div>
        <div className="compact-list">{models.map(model => <div key={model.id}><span className="model-symbol">M</span><div><strong>{model.name}</strong><small>上游：{model.upstream_name}</small></div><div className="capability-tags">{model.supports_tools ? <span>工具</span> : null}{model.supports_vision ? <span>视觉</span> : null}</div><Toggle checked={!!model.enabled} label="启用模型" onChange={async enabled => { await patch(`/api/admin/models/${model.id}`, { enabled }); refreshDetail(); }}/><IconButton label="编辑可见性" onClick={() => openModelEdit(model)}><Pencil size={15}/></IconButton><IconButton label="删除模型" onClick={async () => { if (confirm("删除此模型？")) { await del(`/api/admin/models/${model.id}`); refreshDetail(); } }}><Trash2 size={15}/></IconButton></div>)}</div>
      </div> : <div className="detail-section"><div className="inline-create key-create"><Input type="password" placeholder="粘贴新的上游 API Key" value={newKey} onChange={e => setNewKey(e.target.value)} autoComplete="off"/><Button onClick={async () => { if (!newKey) return; try { await post(`/api/admin/providers/${detail.id}/keys`, { api_key: newKey }); setNewKey(""); toast("Key 已加密保存"); refreshDetail(); } catch (e) { toast(e instanceof Error ? e.message : "添加失败", "error"); } }}><CirclePlus size={15}/> 添加 Key</Button></div>
        {!keys.length && <div className="anonymous-note"><ShieldOff size={18}/><div><strong>当前为匿名渠道</strong><p>未配置密钥是有效状态，请求上游时不会携带认证头。</p></div></div>}
        <div className="compact-list">{keys.map(key => <div key={key.id}><span className="model-symbol"><KeyRound size={15}/></span><div><strong><code>{key.key_hint}</code></strong><small>{key.cooldown_until && new Date(key.cooldown_until) > new Date() ? `冷却至 ${formatDate(key.cooldown_until)}` : key.last_used_at ? `最后使用 ${formatDate(key.last_used_at)}` : "尚未使用"}</small></div><Badge tone={key.cooldown_until && new Date(key.cooldown_until) > new Date() ? "warning" : key.enabled ? "success" : "neutral"}>{key.cooldown_until && new Date(key.cooldown_until) > new Date() ? "冷却中" : key.enabled ? "可用" : "停用"}</Badge><Toggle checked={!!key.enabled} label="启用密钥" onChange={async enabled => { await patch(`/api/admin/keys/${key.id}`, { enabled }); refreshDetail(); }}/><IconButton label="删除密钥" onClick={async () => { if (confirm("删除此上游 Key？")) { await del(`/api/admin/keys/${key.id}`); refreshDetail(); } }}><Trash2 size={15}/></IconButton></div>)}</div>
      </div>}
    </Modal>}
    {modelEdit && <Modal title="模型设置" description={`设置「${modelEdit.name}」的可见范围、输出上限，并确认上游服务条款。`} onClose={() => setModelEdit(null)}>
      <div className="form-stack">
        <Field label="单次输出 Token 上限" hint="0 或留空表示沿用全局上限；按此模型物理窗口设置，避免 max_tokens 超过上游 max_model_len 报 400">
          <Input type="number" min="0" step="1000" value={modelEdit.max_output_tokens ?? 0} onChange={e => setModelEdit({ ...modelEdit, max_output_tokens: Number(e.target.value) || 0 })} placeholder="0 = 沿用全局" />
        </Field>
        <Field label="可见范围" hint="管理员=仅管理员；所有用户=需确认服务条款允许中转；指定用户=仅勾选的用户">
          <Select value={modelEdit.audience || "admin"} onChange={e => setModelEdit({ ...modelEdit, audience: e.target.value as Model["audience"] })}>
            <option value="admin">仅管理员</option><option value="all">所有用户</option><option value="selected">指定用户</option>
          </Select>
        </Field>
        <div className="switch-row"><div><strong>已确认上游服务条款允许中转</strong><small>开放给所有用户前必须确认；这是对上游条款的人工确认</small></div>
          <Toggle checked={!!modelEdit.tos_confirmed} label="确认服务条款" onChange={v => setModelEdit({ ...modelEdit, tos_confirmed: v ? 1 : 0 })} /></div>
        {modelEdit.audience === "selected" && <Field label="指定用户" hint="勾选可使用此模型的普通用户">
          <div className="user-pick-list">{usersForPick.length ? usersForPick.map(u => {
            const ids: string[] = (() => { try { return JSON.parse(modelEdit.allowed_user_ids || "[]"); } catch { return []; } })();
            const checked = ids.includes(u.id);
            return <label key={u.id} className="user-pick"><input type="checkbox" checked={checked} onChange={e => {
              const next = e.target.checked ? [...ids, u.id] : ids.filter(x => x !== u.id);
              setModelEdit({ ...modelEdit, allowed_user_ids: JSON.stringify(next) });
            }}/><span>{u.username}</span></label>;
          }) : <span className="muted">暂无普通用户</span>}</div>
        </Field>}
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setModelEdit(null)}>取消</Button>
          <Button onClick={async () => { try {
            await patch(`/api/admin/models/${modelEdit.id}`, { audience: modelEdit.audience, tos_confirmed: modelEdit.tos_confirmed,
              max_output_tokens: modelEdit.max_output_tokens ?? 0,
              allowed_user_ids: (() => { try { return JSON.parse(modelEdit.allowed_user_ids || "[]"); } catch { return []; } })() });
            toast("模型可见性已保存"); setModelEdit(null); refreshDetail();
          } catch (e) { toast(e instanceof Error ? e.message : "保存失败", "error"); } }}><Check size={16}/> 保存</Button></div>
      </div>
    </Modal>}
  </>;
}
