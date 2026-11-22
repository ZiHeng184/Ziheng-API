import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, KeyRound, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import { Logo } from "../components/Logo";
import { Button, Input } from "../components/UI";
import { post } from "../api";

type Config = { devLogin: boolean; demoMode: boolean };

export default function Register({ config, onRegistered, onBack }: { config: Config; onRegistered: (username: string, role: string) => void; onBack: () => void }) {
  const [form, setForm] = useState({ username: "", email: "", emailCode: "", inviteCode: "", password: "", confirm: "" });
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false); const [countdown, setCountdown] = useState(0);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  useEffect(() => {
    if (!countdown) return;
    const timer = setInterval(() => setCountdown(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const sendCode = async () => {
    setError(""); setNotice("");
    if (!form.email) { setError("请先填写邮箱地址"); return; }
    setSending(true);
    try {
      const result = await post<{ sent: boolean; devCode?: string; message?: string }>("/api/auth/email-code", { email: form.email });
      setNotice(result.devCode ? `开发回显模式，验证码：${result.devCode}` : (result.message || "验证码已发送，请查收邮箱"));
      setCountdown(60);
    } catch (e) { setError(e instanceof Error ? e.message : "发送失败"); }
    finally { setSending(false); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    if (form.password !== form.confirm) { setError("两次输入的密码不一致"); return; }
    setLoading(true);
    try {
      const result = await post<{ username: string; role: string }>("/api/auth/register", {
        username: form.username, email: form.email, password: form.password,
        inviteCode: form.inviteCode, emailCode: form.emailCode
      });
      onRegistered(result.username, result.role);
    } catch (e) {
      setError(e instanceof Error ? e.message : "注册失败");
    } finally { setLoading(false); }
  };

  return <main className="login-page">
    <section className="login-story"><div className="login-story-inner"><Logo />
      <div className="story-content"><span className="story-kicker"><span /> INVITE ONLY</span><h1>凭邀请码，<br />创建你的账号。</h1><p>注册需要管理员发放的邀请码与邮箱验证码。注册后即可创建自己的 API Key，通过统一接口调用模型。</p>
        <div className="story-features"><div><KeyRound /><span><strong>独立密钥</strong><small>自己的 Key、额度与用量</small></span></div><div><ShieldCheck /><span><strong>邮箱验证</strong><small>验证码 10 分钟内有效</small></span></div></div>
      </div><div className="story-foot"><span className="live-dot" /> WORKERS · D1 · EDGE</div>
    </div><div className="story-grid" /><div className="story-orbit orbit-one" /><div className="story-orbit orbit-two" /></section>
    <section className="login-form-wrap"><form className="login-form" onSubmit={submit}>
      <div className="mobile-login-logo"><Logo /></div><span className="login-icon"><UserRound size={22} /></span>
      <h2>注册账号</h2><p>邀请码 + 邮箱验证码，缺一不可</p>
      <label className="field"><span className="field-label">用户名</span><Input value={form.username} onChange={set("username")} placeholder="3-24 位字母、数字或下划线" autoComplete="username" required /></label>
      <label className="field"><span className="field-label">邮箱</span><Input type="email" value={form.email} onChange={set("email")} placeholder="用于接收验证码" autoComplete="email" required /></label>
      <label className="field"><span className="field-label">邮箱验证码</span><div className="code-row"><Input value={form.emailCode} onChange={set("emailCode")} placeholder="6 位数字" inputMode="numeric" maxLength={6} required /><Button type="button" variant="secondary" loading={sending} disabled={countdown > 0} onClick={sendCode}><Mail size={15} />{countdown ? `${countdown}s` : "发送验证码"}</Button></div></label>
      <label className="field"><span className="field-label">邀请码</span><Input value={form.inviteCode} onChange={set("inviteCode")} placeholder="向管理员索取" required /></label>
      <div className="form-grid"><label className="field"><span className="field-label">密码</span><Input type="password" value={form.password} onChange={set("password")} placeholder="至少 12 个字符" autoComplete="new-password" required /></label><label className="field"><span className="field-label">确认密码</span><Input type="password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" required /></label></div>
      {notice && <div className="form-notice"><Check size={14} /> {notice}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <Button className="login-submit" loading={loading} type="submit">创建账号 <ArrowRight size={17} /></Button>
      <button type="button" className="auth-switch" onClick={onBack}><ArrowLeft size={14} /> 返回登录</button>
      <small className="login-privacy"><LockKeyhole size={12} /> 密码加盐哈希存储，注册即代表仅限授权用途使用</small>
    </form></section>
  </main>;
}
