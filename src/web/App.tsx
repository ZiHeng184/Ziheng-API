import { useCallback, useEffect, useState } from "react";
import { Activity, BookOpenCheck, Boxes, ChevronRight, CircleUserRound, KeyRound, LayoutDashboard, LogOut, Menu, Moon, Network, Route, Settings, Sun, Ticket, UsersRound, X } from "lucide-react";
import Models from "./pages/Models";
import { Logo } from "./components/Logo";
import { IconButton, Toasts } from "./components/UI";
import { api, post } from "./api";
import type { ToastItem } from "./types";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Providers from "./pages/Providers";
import Routes from "./pages/Routes";
import Tokens from "./pages/Tokens";
import Errors from "./pages/Errors";
import SettingsPage from "./pages/Settings";
import Playground from "./pages/Playground";
import Users from "./pages/Users";
import Invites from "./pages/Invites";
import Profile from "./pages/Profile";

type Session = { id?: string; username: string; role?: string; email?: string | null; expiresAt: string } | null;
type Config = { devLogin: boolean; demoMode: boolean };

const adminPages = [
  { id: "dashboard", label: "概览", icon: LayoutDashboard, group: "工作台" },
  { id: "providers", label: "渠道管理", icon: Boxes, group: "工作台" },
  { id: "routes", label: "路由编排", icon: Route, group: "工作台" },
  { id: "tokens", label: "API 密钥", icon: KeyRound, group: "工作台" },
  { id: "playground", label: "在线调试", icon: BookOpenCheck, group: "工作台" },
  { id: "errors", label: "错误日志", icon: Activity, group: "系统" },
  { id: "users", label: "用户管理", icon: UsersRound, group: "系统" },
  { id: "invites", label: "邀请码", icon: Ticket, group: "系统" },
  { id: "settings", label: "系统设置", icon: Settings, group: "系统" }
];
const userPages = [
  { id: "tokens", label: "我的 API 密钥", icon: KeyRound, group: "工作台" },
  { id: "models", label: "模型广场", icon: Boxes, group: "工作台" },
  { id: "playground", label: "在线调试", icon: BookOpenCheck, group: "工作台" },
  { id: "profile", label: "账号设置", icon: CircleUserRound, group: "系统" }
];

export default function App() {
  const [session, setSession] = useState<Session>(null); const [config, setConfig] = useState<Config | null>(null); const [loading, setLoading] = useState(true);
  const [authView, setAuthView] = useState<"login" | "register">("login");
  const [page, setPage] = useState(location.hash.slice(1) || "dashboard"); const [sidebar, setSidebar] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("ziheng-theme") || "system"); const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [playgroundModel, setPlaygroundModel] = useState("");
  const isAdmin = session?.role !== "user";
  const pages = isAdmin ? adminPages : userPages;
  const toast = useCallback((message: string, type: "success" | "error" = "success") => {
    const id = Date.now(); setToasts(items => [...items, { id, message, type }]); setTimeout(() => setToasts(items => items.filter(item => item.id !== id)), 3500);
  }, []);
  useEffect(() => {
    const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light"; localStorage.setItem("ziheng-theme", theme);
  }, [theme]);
  useEffect(() => {
    Promise.all([api<Session>("/api/auth/session"), api<Config>("/api/config")]).then(([user, cfg]) => {
      setSession(user); setConfig(cfg);
      if (user?.role === "user" && !userPages.some(p => p.id === (location.hash.slice(1) || ""))) setPage("tokens");
    }).catch(() => {}).finally(() => setLoading(false));
    const unauthorized = () => setSession(null); window.addEventListener("ziheng:unauthorized", unauthorized);
    const hash = () => setPage(location.hash.slice(1) || (session?.role === "user" ? "tokens" : "dashboard")); window.addEventListener("hashchange", hash);
    return () => { window.removeEventListener("ziheng:unauthorized", unauthorized); window.removeEventListener("hashchange", hash); };
  }, []);
  const navigate = (id: string) => { location.hash = id; setPage(id); setSidebar(false); };
  const useModel = (name: string) => { setPlaygroundModel(name); navigate("playground"); };
  const logout = async () => { await post("/api/auth/logout"); setSession(null); setAuthView("login"); };
  if (loading) return <div className="app-loading"><Logo compact /><span className="loading-line" /></div>;
  if (!session && config) return authView === "register"
    ? <Register config={config} onBack={() => setAuthView("login")} onRegistered={(username, role) => { setSession({ username, role, expiresAt: "" }); setPage(role === "user" ? "tokens" : "dashboard"); }} />
    : <Login config={config} onLogin={(username, role) => { setSession({ username, role, expiresAt: "" }); setPage(role === "user" ? "tokens" : "dashboard"); }} onRegister={() => setAuthView("register")} />;
  if (!session) return null;
  const current = pages.find(item => item.id === page) || pages[0];
  const activePage = pages.some(item => item.id === page) ? page : pages[0].id;
  const props = { toast };
  const groups = [...new Set(pages.map(item => item.group))];
  return <div className="app-shell">
    {sidebar && <div className="sidebar-scrim" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? "is-open" : ""}`}><div className="sidebar-head"><Logo /><IconButton label="关闭菜单" className="mobile-close" onClick={() => setSidebar(false)}><X size={18} /></IconButton></div>
      <nav className="main-nav">{groups.map((group, index) => <div key={group}><span className={`nav-section ${index ? "nav-section-second" : ""}`}>{group}</span>{pages.filter(item => item.group === group).map(item => <button key={item.id} className={activePage === item.id ? "active" : ""} onClick={() => navigate(item.id)}><item.icon size={18} /><span>{item.label}</span>{activePage === item.id && <ChevronRight size={14} className="nav-arrow" />}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="edge-card"><div><Network size={16} /><strong>Edge 网络</strong><span className="live-dot" /></div><p>Cloudflare Workers</p><small>服务运行正常</small></div><div className="sidebar-user"><span className="avatar">{session.username.slice(0, 1).toUpperCase()}</span><div><strong>{session.username}</strong><small>{isAdmin ? "超级管理员" : "普通用户"}</small></div><IconButton label="退出登录" onClick={logout}><LogOut size={17} /></IconButton></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="topbar-left"><IconButton label="打开菜单" className="menu-button" onClick={() => setSidebar(true)}><Menu size={20} /></IconButton><span className="topbar-section">控制台</span><ChevronRight size={14} /><strong>{current.label}</strong></div>
      <div className="topbar-right"><span className="environment"><span className="live-dot" /> {config?.demoMode ? "演示环境" : "生产环境"}</span><IconButton label="切换主题" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</IconButton><IconButton label="账号" onClick={() => navigate(isAdmin ? "settings" : "profile")}><CircleUserRound size={19} /></IconButton></div></header>
      <main className="content">
        {activePage === "dashboard" && isAdmin && <Dashboard {...props} onNavigate={navigate} demoMode={!!config?.demoMode} />}
        {activePage === "providers" && isAdmin && <Providers {...props} />}
        {activePage === "routes" && isAdmin && <Routes {...props} />}
        {activePage === "tokens" && <Tokens {...props} demoMode={!!config?.demoMode} scope={isAdmin ? "admin" : "me"} />}
        {activePage === "models" && <Models {...props} onUse={useModel} />}
        {activePage === "playground" && <Playground {...props} demoMode={!!config?.demoMode} scope={isAdmin ? "admin" : "me"} presetModel={playgroundModel} />}
        {activePage === "errors" && isAdmin && <Errors {...props} />}
        {activePage === "users" && isAdmin && <Users {...props} />}
        {activePage === "invites" && isAdmin && <Invites {...props} />}
        {activePage === "settings" && isAdmin && <SettingsPage {...props} />}
        {activePage === "profile" && <Profile {...props} />}
      </main>
    </div><Toasts items={toasts} dismiss={id => setToasts(items => items.filter(item => item.id !== id))} />
  </div>;
}
