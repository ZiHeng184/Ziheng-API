import { useEffect, useState } from "react";
import { Check, Copy, Plus, Ticket, Trash2 } from "lucide-react";
import { api, del, formatDate, patch, post } from "../api";
import { Badge, Button, Field, IconButton, Input, Modal, PageHeader, Toggle } from "../components/UI";

type Invite = { id: string; code: string; note: string; max_uses: number; used_count: number; enabled: number; expires_at: string | null; created_at: string };
type Notify = (message: string, type?: "success" | "error") => void;
const blank = { code: "", max_uses: "1", note: "", expires_at: "" };

export default function Invites({ toast }: { toast: Notify }) {
  const [invites, setInvites] = useState<Invite[]>([]); const [editor, setEditor] = useState(false); const [form, setForm] = useState(blank); const [copied, setCopied] = useState("");
  const load = async () => { try { setInvites(await api<Invite[]>("/api/admin/invites")); } catch (e) { toast(e instanceof Error ? e.message : "加载失败", "error"); } };
  useEffect(() => { load(); }, []);
  const copy = async (code: string) => { await navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(""), 1600); };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await post<{ code: string }>("/api/admin/invites", { code: form.code || undefined, max_uses: Number(form.max_uses) || 1, note: form.note, expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null });
      toast(`邀请码 ${result.code} 已创建`); setEditor(false); setForm(blank); load();
    } catch (e) { toast(e instanceof Error ? e.message : "创建失败", "error"); }
  };
  return <>
    <PageHeader eyebrow="INVITATIONS" title="邀请码" description="注册必须填写有效邀请码。可限制使用次数与有效期，随时停用。" actions={<Button onClick={() => setEditor(true)}><Plus size={16} /> 生成邀请码</Button>} />
    <section className="panel table-panel"><div className="table-toolbar"><div><strong>邀请码列表</strong><span className="toolbar-subtitle">{invites.length} 个 · 注册时与邮箱验证码同时校验</span></div></div>
      <div className="table-scroll"><table><thead><tr><th>邀请码</th><th>备注</th><th>使用情况</th><th>过期时间</th><th>状态</th><th className="align-right">操作</th></tr></thead><tbody>
        {invites.map(invite => <tr key={invite.id}><td><div className="token-name"><code style={{ fontSize: 14 }}>{invite.code}</code></div></td><td>{invite.note || "—"}</td>
          <td>{invite.used_count} / {invite.max_uses} 次</td><td><span className="date-cell">{formatDate(invite.expires_at)}</span></td>
          <td><Badge tone={invite.enabled && invite.used_count < invite.max_uses ? "success" : "neutral"}>{!invite.enabled ? "已停用" : invite.used_count >= invite.max_uses ? "已用完" : "可用"}</Badge></td>
          <td><div className="row-actions"><IconButton label="复制邀请码" onClick={() => copy(invite.code)}>{copied === invite.code ? <Check size={16} /> : <Copy size={16} />}</IconButton>
            <Toggle checked={!!invite.enabled} label="启用邀请码" onChange={async enabled => { await patch(`/api/admin/invites/${invite.id}`, { enabled }); load(); }} />
            <IconButton label="删除邀请码" onClick={async () => { if (confirm("确定删除此邀请码？")) { await del(`/api/admin/invites/${invite.id}`); toast("已删除"); load(); } }}><Trash2 size={16} /></IconButton>
          </div></td></tr>)}
        {!invites.length && <tr><td colSpan={6} style={{ textAlign: "center", padding: 32 }}>还没有邀请码，点击右上角生成。</td></tr>}
      </tbody></table></div></section>
    <div className="security-note" style={{ marginTop: 16 }}><Ticket size={17} /> 注册流程：填写用户名与邮箱 → 获取邮箱验证码 → 输入邀请码与密码后创建账号。</div>
    {editor && <Modal title="生成邀请码" description="留空邀请码将自动生成随机值。次数用完后该码自动失效。" onClose={() => setEditor(false)}><form onSubmit={create} className="form-stack">
      <Field label="邀请码（可选）" hint="4-40 位字母、数字或连字符"><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="留空自动生成" /></Field>
      <div className="form-grid"><Field label="可使用次数" required><Input type="number" min="1" value={form.max_uses} onChange={e => setForm({ ...form, max_uses: e.target.value })} required /></Field><Field label="过期时间" hint="留空表示永久"><Input type="datetime-local" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} /></Field></div>
      <Field label="备注"><Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="例如：给朋友小明" /></Field>
      <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setEditor(false)}>取消</Button><Button type="submit"><Check size={16} /> 创建</Button></div>
    </form></Modal>}
  </>;
}
