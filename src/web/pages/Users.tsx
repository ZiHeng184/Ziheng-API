import { useEffect, useState } from "react";
import { Check, Gauge, KeyRound, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { api, del, patch, post } from "../api";
import { formatDate, formatNumber } from "../api";
import { Badge, Button, Field, IconButton, Input, Modal, PageHeader, Toggle } from "../components/UI";

type UserRow = { id: string; username: string; email: string | null; role: string; enabled: number; created_at: string; token_count: number; used_requests: number; monthly_request_limit: number | null; monthly_token_limit: number | null; month_requests: number; month_tokens: number };
type Notify = (message: string, type?: "success" | "error") => void;

export default function Users({ toast }: { toast: Notify }) {
  const [users, setUsers] = useState<UserRow[]>([]); const [reset, setReset] = useState<{ username: string; password: string } | null>(null);
  const [quotaEdit, setQuotaEdit] = useState<UserRow | null>(null); const [quotaForm, setQuotaForm] = useState({ monthly_request_limit: "", monthly_token_limit: "" });
  const load = async () => { try { setUsers(await api<UserRow[]>("/api/admin/users")); } catch (e) { toast(e instanceof Error ? e.message : "加载失败", "error"); } };
  useEffect(() => { load(); }, []);
  return <>
    <PageHeader eyebrow="ACCOUNTS" title="用户管理" description="查看注册用户、启停账号、重置密码；管理员与普通用户权限隔离。" />
    <section className="panel table-panel"><div className="table-toolbar"><div><strong>全部账号</strong><span className="toolbar-subtitle">{users.length} 个用户 · {users.filter(u => u.role === "user").length} 个注册用户</span></div></div>
      <div className="table-scroll"><table><thead><tr><th>用户</th><th>角色</th><th>API Key</th><th>累计请求</th><th>本月额度</th><th>注册时间</th><th>状态</th><th className="align-right">操作</th></tr></thead><tbody>
        {users.map(user => <tr key={user.id}><td><div className="token-name"><strong>{user.username}</strong><code>{user.email || "未绑定邮箱"}</code></div></td>
          <td><Badge tone={user.role === "admin" ? "warning" : "neutral"}>{user.role === "admin" ? "管理员" : "普通用户"}</Badge></td>
          <td>{user.token_count}</td><td>{formatNumber(user.used_requests)}</td><td><div className="usage-cell"><span>{formatNumber(user.month_requests)} / {user.monthly_request_limit === null ? "不限" : formatNumber(user.monthly_request_limit)} 次</span><small>{formatNumber(user.month_tokens)} / {user.monthly_token_limit === null ? "不限" : formatNumber(user.monthly_token_limit)} Tokens</small></div></td><td><span className="date-cell">{formatDate(user.created_at)}</span></td>
          <td><Badge tone={user.enabled ? "success" : "neutral"}>{user.enabled ? "正常" : "已停用"}</Badge></td>
          <td><div className="row-actions"><IconButton label="设置额度" onClick={() => { setQuotaEdit(user); setQuotaForm({ monthly_request_limit: user.monthly_request_limit === null ? "" : String(user.monthly_request_limit), monthly_token_limit: user.monthly_token_limit === null ? "" : String(user.monthly_token_limit) }); }}><Gauge size={16}/></IconButton><Toggle checked={!!user.enabled} label="启用账号" onChange={async enabled => { try { await patch(`/api/admin/users/${user.id}`, { enabled }); toast(enabled ? "账号已启用" : "账号已停用"); load(); } catch (e) { toast(e instanceof Error ? e.message : "操作失败", "error"); } }} />
            <IconButton label="重置密码" onClick={async () => { if (!confirm(`确定重置 ${user.username} 的密码？其所有会话将退出。`)) return; try { const r = await post<{ password: string }>(`/api/admin/users/${user.id}/reset-password`); setReset({ username: user.username, password: r.password }); } catch (e) { toast(e instanceof Error ? e.message : "重置失败", "error"); } }}><KeyRound size={16} /></IconButton>
            <IconButton label="删除用户" onClick={async () => { if (!confirm(`删除 ${user.username} 将同时删除其全部 API Key，确定继续？`)) return; try { await del(`/api/admin/users/${user.id}`); toast("用户已删除"); load(); } catch (e) { toast(e instanceof Error ? e.message : "删除失败", "error"); } }}><Trash2 size={16} /></IconButton>
          </div></td></tr>)}
      </tbody></table></div></section>
    {quotaEdit && <Modal title={`设置 ${quotaEdit.username} 的每月额度`} description="留空表示不限额度；保存后立即生效，用量次月自动重置。" onClose={() => setQuotaEdit(null)}><form className="form-stack" onSubmit={async e => { e.preventDefault(); try { await patch(`/api/admin/users/${quotaEdit.id}`, { monthly_request_limit: quotaForm.monthly_request_limit === "" ? null : Number(quotaForm.monthly_request_limit), monthly_token_limit: quotaForm.monthly_token_limit === "" ? null : Number(quotaForm.monthly_token_limit) }); toast("额度已更新"); setQuotaEdit(null); load(); } catch (err) { toast(err instanceof Error ? err.message : "保存失败", "error"); } }}><Field label="每月请求额度" hint="留空不限；普通用户建议 200–500"><Input type="number" min="0" value={quotaForm.monthly_request_limit} onChange={e => setQuotaForm({ ...quotaForm, monthly_request_limit: e.target.value })} placeholder="不限" /></Field><Field label="每月 Token 额度" hint="留空不限"><Input type="number" min="0" step="10000" value={quotaForm.monthly_token_limit} onChange={e => setQuotaForm({ ...quotaForm, monthly_token_limit: e.target.value })} placeholder="不限" /></Field><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setQuotaEdit(null)}>取消</Button><Button type="submit"><Check size={16}/> 保存额度</Button></div></form></Modal>}
    <div className="security-note" style={{ marginTop: 16 }}><UsersRound size={17} /> 普通用户登录后只能管理自己的 API Key 与账号密码，无法访问渠道、路由和其他用户数据。</div>
    {reset && <Modal title="密码已重置" description={`请将新密码一次性告知 ${reset.username}，关闭后无法再次查看。`} onClose={() => setReset(null)}><div className="created-key"><code>{reset.password}</code><Button onClick={async () => { await navigator.clipboard.writeText(reset.password); toast("已复制"); }}>复制新密码</Button></div><div className="modal-actions"><Button onClick={() => setReset(null)}>我已保存</Button></div></Modal>}
    <div style={{ display: "none" }}><ShieldCheck /></div>
  </>;
}
