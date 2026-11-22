import { useEffect, useState } from "react";
import { Check, CircleUserRound, KeyRound, ShieldCheck } from "lucide-react";
import { api, formatDate, formatNumber, post } from "../api";
import { Badge, Button, Field, Input, PageHeader } from "../components/UI";

type Profile = { username: string; email: string | null; role: string; createdAt: string; usage: { tokens: number; requests: number; used_tokens: number };
  quota: { requestLimit: number | null; tokenLimit: number | null; usedRequests: number; usedTokens: number; month: string } };
type Notify = (message: string, type?: "success" | "error") => void;

export default function Profile({ toast }: { toast: Notify }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [passwords, setPasswords] = useState({ current: "", password: "", confirm: "" });
  useEffect(() => { api<Profile>("/api/me/profile").then(setProfile).catch(e => toast(e instanceof Error ? e.message : "加载失败", "error")); }, []);
  if (!profile) return <div className="page-loading">正在读取账号信息…</div>;
  return <>
    <PageHeader eyebrow="MY ACCOUNT" title="账号设置" description="查看账号信息与用量，修改登录密码。" />
    <div className="settings-grid">
      <section className="panel settings-section"><header className="settings-title"><span><CircleUserRound size={19} /></span><div><h2>账号信息</h2><p>注册身份与调用用量</p></div></header>
        <div className="settings-body status-settings">
          <div><span>用户名</span><strong>{profile.username}</strong><Badge tone={profile.role === "admin" ? "warning" : "neutral"}>{profile.role === "admin" ? "管理员" : "普通用户"}</Badge></div>
          <div><span>邮箱</span><strong>{profile.email || "未绑定"}</strong></div>
          <div><span>注册时间</span><strong>{formatDate(profile.createdAt)}</strong></div>
          <div><span>我的 API Key</span><strong>{profile.usage.tokens} 个</strong></div>
          <div><span>累计请求</span><strong>{formatNumber(profile.usage.requests)} 次</strong></div>
          <div><span>累计 Token</span><strong>{formatNumber(profile.usage.used_tokens)}</strong></div>
        </div></section>
      <section className="panel settings-section"><header className="settings-title"><span><Check size={19} /></span><div><h2>本月免费额度</h2><p>{profile.quota?.month || ""} · 由管理员设置，用完次月自动重置</p></div></header>
        <div className="settings-body status-settings">
          <div><span>请求额度</span><strong>{formatNumber(profile.quota?.usedRequests)} / {profile.quota?.requestLimit === null ? "不限" : formatNumber(profile.quota?.requestLimit || 0)}</strong></div>
          <div><span>Token 额度</span><strong>{formatNumber(profile.quota?.usedTokens)} / {profile.quota?.tokenLimit === null ? "不限" : formatNumber(profile.quota?.tokenLimit || 0)}</strong></div>
          <div><span>每分钟限流</span><strong>已启用防滥用保护</strong></div>
        </div></section>
      <section className="panel settings-section"><header className="settings-title"><span><KeyRound size={19} /></span><div><h2>修改密码</h2><p>修改后所有现有会话将立即退出</p></div></header>
        <form className="settings-body" onSubmit={async e => {
          e.preventDefault();
          if (passwords.password !== passwords.confirm) return toast("两次输入的新密码不一致", "error");
          try { await post("/api/me/password", passwords); toast("密码已更新，请重新登录"); setTimeout(() => location.reload(), 900); }
          catch (err) { toast(err instanceof Error ? err.message : "修改失败", "error"); }
        }}>
          <Field label="当前密码" required><Input type="password" autoComplete="current-password" value={passwords.current} onChange={e => setPasswords({ ...passwords, current: e.target.value })} required /></Field>
          <div className="form-grid"><Field label="新密码" hint="至少 12 个字符"><Input type="password" autoComplete="new-password" value={passwords.password} onChange={e => setPasswords({ ...passwords, password: e.target.value })} required /></Field><Field label="确认新密码"><Input type="password" autoComplete="new-password" value={passwords.confirm} onChange={e => setPasswords({ ...passwords, confirm: e.target.value })} required /></Field></div>
          <Button type="submit"><Check size={16} /> 更新密码</Button>
        </form></section>
      <section className="panel settings-section"><header className="settings-title"><span><ShieldCheck size={19} /></span><div><h2>使用方式</h2><p>用你的 API Key 调用统一接口</p></div></header>
        <div className="settings-body"><ul className="privacy-list">
          <li><Check size={15} /> 接口地址：{location.origin}/v1/chat/completions</li>
          <li><Check size={15} /> 认证头：Authorization: Bearer 你的Key</li>
          <li><Check size={15} /> 模型列表：GET /v1/models（含 auto 路由）</li>
          <li><Check size={15} /> Key 仅在创建时完整显示一次，请妥善保存</li>
        </ul></div></section>
    </div>
  </>;
}
