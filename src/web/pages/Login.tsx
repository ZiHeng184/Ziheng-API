import { useState } from "react";
import { ArrowRight, Check, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { Logo } from "../components/Logo";
import { Button, Input } from "../components/UI";
import { post } from "../api";

type Config = { devLogin: boolean; demoMode: boolean };

export default function Login({ config, onLogin, onRegister }: { config: Config; onLogin: (username: string, role: string) => void; onRegister: () => void }) {
  const [username, setUsername] = useState(config.demoMode ? "admin" : "");
  const [password, setPassword] = useState(config.demoMode ? "Ziheng2026!" : "");
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setLoading(true);
    try { const result = await post<{ username: string; role?: string }>("/api/auth/login", { username, password }); onLogin(result.username || username, result.role || "admin"); }
    catch (error) { setError(error instanceof Error ? error.message : "登录失败"); }
    finally { setLoading(false); }
  };
  return <main className="login-page">
    <section className="login-story">
      <div className="login-story-inner"><Logo />
        <div className="story-content"><span className="story-kicker"><span /> CLOUDFLARE NATIVE</span><h1>把每一个模型，<br />接入同一个出口。</h1><p>为个人开发者打造的轻量 AI 中转站。渠道、密钥与降级策略，都由你掌控。</p>
          <div className="story-features"><div><ShieldCheck /><span><strong>私密且自主</strong><small>密码哈希与服务端会话</small></span></div><div><KeyRound /><span><strong>统一兼容接口</strong><small>OpenAI 格式，无缝连接现有工具</small></span></div></div>
        </div><div className="story-foot"><span className="live-dot" /> WORKERS · D1 · EDGE</div>
      </div><div className="story-grid" /><div className="story-orbit orbit-one" /><div className="story-orbit orbit-two" />
    </section>
    <section className="login-form-wrap"><form className="login-form" onSubmit={submit}>
      <div className="mobile-login-logo"><Logo /></div><span className="login-icon"><LockKeyhole size={22} /></span>
      <h2>欢迎回来</h2><p>登录你的私有 AI 控制台</p>
      {config.demoMode && <div className="demo-notice"><strong>公网演示环境</strong><span>凭据已为你填好，点击登录即可体验。</span><div><Check size={14} /> 不连接真实上游，不涉及你的密钥</div></div>}
      <label className="field"><span className="field-label">管理员账号</span><Input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" placeholder="请输入账号" required /></label>
      <label className="field"><span className="field-label">管理员密码</span><Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" placeholder="请输入密码" required /></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <Button className="login-submit" loading={loading} type="submit">进入控制台 <ArrowRight size={17} /></Button>
      <button type="button" className="auth-switch" onClick={onRegister}>没有账号？<strong>使用邀请码注册</strong></button>
      <small className="login-privacy">仅限授权管理员访问 · 会话 7 天有效</small>
    </form></section>
  </main>;
}
