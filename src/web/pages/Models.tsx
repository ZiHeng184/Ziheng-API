import { useEffect, useMemo, useState } from "react";
import { Activity, Boxes, CheckCircle2, Filter, GitBranch, Search, ShieldAlert, Sparkles, Wrench, Image as ImageIcon } from "lucide-react";
import { api } from "../api";
import type { Catalog } from "../types";
import { Badge, PageHeader } from "../components/UI";

const statusMeta = {
  available: { label: "可用", tone: "success" as const, icon: CheckCircle2 },
  degraded: { label: "渠道冷却中", tone: "warning" as const, icon: Activity },
  unavailable: { label: "不可用", tone: "danger" as const, icon: ShieldAlert }
};

export default function Models({ toast, onUse }: { toast: (message: string, type?: "success" | "error") => void; onUse?: (name: string) => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [query, setQuery] = useState("");
  const [cap, setCap] = useState<"all" | "tools" | "vision">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "available">("all");

  useEffect(() => {
    api<Catalog>("/api/me/catalog").then(setCatalog).catch(e => toast(e instanceof Error ? e.message : "加载模型失败", "error"));
  }, []);

  const models = useMemo(() => {
    if (!catalog) return [];
    return catalog.models.filter(m => {
      if (!query || !`${m.name} ${m.provider} ${m.upstreamName}`.toLowerCase().includes(query.toLowerCase())) return false;
      if (cap === "tools" && !m.supportsTools) return false;
      if (cap === "vision" && !m.supportsVision) return false;
      if (statusFilter === "available" && m.status !== "available") return false;
      return true;
    });
  }, [catalog, query, cap, statusFilter]);

  if (!catalog) return <div className="page-loading">正在读取模型目录…</div>;
  const available = catalog.models.filter(m => m.status === "available").length;

  return <>
    <PageHeader eyebrow="MODEL CATALOG" title="模型广场" description="浏览当前账号可用的模型与命名路由，查看能力、渠道健康度并直接调试。" />
    <section className="metric-grid token-metrics">
      <article className="metric-card"><span className="metric-simple-label">可见模型</span><strong>{catalog.models.length}</strong><small>按你的账号权限过滤</small></article>
      <article className="metric-card"><span className="metric-simple-label">当前可用</span><strong>{available}</strong><small>渠道健康 · 可立即调用</small></article>
      <article className="metric-card"><span className="metric-simple-label">命名路由</span><strong>{catalog.routes.length}</strong><small>自动降级 / 别名</small></article>
      <article className="metric-card"><span className="metric-simple-label">支持工具</span><strong>{catalog.models.filter(m => m.supportsTools).length}</strong><small>Function Calling</small></article>
    </section>

    <section className="panel table-panel">
      <div className="table-toolbar catalog-toolbar">
        <div className="catalog-search"><Search size={16} /><input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索模型名 / 上游 / 渠道…" /></div>
        <div className="catalog-filters"><Filter size={15} />
          <button className={cap === "all" ? "active" : ""} onClick={() => setCap("all")}>全部</button>
          <button className={cap === "tools" ? "active" : ""} onClick={() => setCap("tools")}><Wrench size={13} /> 工具</button>
          <button className={cap === "vision" ? "active" : ""} onClick={() => setCap("vision")}><ImageIcon size={13} /> 视觉</button>
          <span className="catalog-divider" />
          <button className={statusFilter === "available" ? "active" : ""} onClick={() => setStatusFilter(statusFilter === "all" ? "available" : "all")}>仅看可用</button>
        </div>
      </div>
      <div className="table-scroll"><table><thead><tr><th>模型</th><th>渠道</th><th>能力</th><th>可见范围</th><th>状态</th><th className="align-right">操作</th></tr></thead><tbody>
        {models.map(m => {
          const meta = statusMeta[m.status]; const StatusIcon = meta.icon;
          return <tr key={m.id}>
            <td><div className="token-name"><strong>{m.name}</strong><code>{m.upstreamName}</code></div></td>
            <td><div className="permission-cell"><span>{m.provider}</span><small>{m.protocol} · 优先级 {m.priority}</small></div></td>
            <td><div className="catalog-caps">{m.supportsTools && <Badge tone="info"><Wrench size={12} /> 工具</Badge>}{m.supportsVision && <Badge tone="purple"><ImageIcon size={12} /> 视觉</Badge>}{!m.supportsTools && !m.supportsVision && <span className="muted">基础对话</span>}</div></td>
            <td><Badge tone={m.audience === "all" ? "success" : m.audience === "selected" ? "info" : "neutral"}>{m.audience === "all" ? "所有用户" : m.audience === "selected" ? "指定用户" : "管理员"}</Badge></td>
            <td><Badge tone={meta.tone}><StatusIcon size={12} /> {meta.label}</Badge></td>
            <td className="align-right">{onUse && <button className="btn btn-ghost btn-sm" onClick={() => onUse(m.name)}><Sparkles size={14} /> 调试</button>}</td>
          </tr>;
        })}
        {!models.length && <tr><td colSpan={6} className="empty-row">没有符合条件的模型，试试调整筛选条件。</td></tr>}
      </tbody></table></div>
    </section>

    {!!catalog.routes.length && <section className="panel" style={{ marginTop: 16 }}>
      <header className="panel-header"><div><h2><GitBranch size={17} /> 命名路由</h2><p>一个名称聚合多个模型，失败时自动降级切换</p></div></header>
      <div className="catalog-routes">{catalog.routes.map(r => <div key={r.name} className="catalog-route"><div><strong>{r.name}</strong><small>{r.description || "自动选择可用渠道"}</small></div><Badge tone="info">{r.targets} 个渠道</Badge>{onUse && <button className="btn btn-ghost btn-sm" onClick={() => onUse(r.name)}><Sparkles size={14} /> 调试</button>}</div>)}</div>
    </section>}
    <div className="security-note" style={{ marginTop: 16 }}><Boxes size={17} /> 模型可用度根据渠道启用状态、密钥冷却情况实时计算；"不可用" 不代表永久失效，稍后可刷新重试。</div>
  </>;
}
