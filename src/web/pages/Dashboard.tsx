import { useEffect, useState } from "react";
import { Activity, ArrowRight, Boxes, Braces, CheckCircle2, CircleAlert, KeyRound, Plus, RefreshCw, Route, Sparkles, Zap } from "lucide-react";
import { api, formatDate, formatNumber } from "../api";
import { Badge, Button, IconButton, PageHeader } from "../components/UI";

type Overview = {
  totals: { requests: number; errors: number; input_tokens: number; output_tokens: number }; today: { requests: number; errors: number };
  counts: { providers: number; models: number; tokens: number }; days: { day: string; requests: number; errors: number; input_tokens: number; output_tokens: number }[];
  providers: { id: string; name: string; protocol: string; enabled: number; errors: number }[];
  recentErrors: { id: string; route_model: string; provider_name?: string; message: string; created_at: string; status?: number }[];
};

function UsageChart({ days }: { days: Overview["days"] }) {
  const width = 720, height = 220, left = 20, right = 20, top = 20, bottom = 30;
  const max = Math.max(...days.map(day => day.requests), 1) * 1.2;
  const points = days.map((day, index) => ({ x: left + index * ((width - left - right) / Math.max(days.length - 1, 1)), y: top + (height - top - bottom) * (1 - day.requests / max), ...day }));
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const area = points.length ? `${line} L${points[points.length - 1].x},${height - bottom} L${points[0].x},${height - bottom} Z` : "";
  return <div className="chart-wrap"><svg className="usage-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="最近七日请求量趋势">
    <defs><linearGradient id="usageArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".24"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs>
    {[0, 1, 2, 3].map(index => <line key={index} x1={left} x2={width-right} y1={top + index * 48} y2={top + index * 48} className="chart-grid" />)}
    {area && <><path d={area} fill="url(#usageArea)"/><path d={line} className="chart-line"/></>}
    {points.map((point, index) => <g key={point.day}><circle cx={point.x} cy={point.y} r="4" className="chart-point"/><text x={point.x} y={height-7} textAnchor="middle" className="chart-label">{new Date(`${point.day}T00:00:00`).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</text><title>{point.requests} 次请求</title></g>)}
  </svg></div>;
}

export default function Dashboard({ toast, onNavigate, demoMode }: { toast: (message: string, type?: "success" | "error") => void; onNavigate: (page: string) => void; demoMode?: boolean }) {
  const [data, setData] = useState<Overview | null>(null); const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); try { setData(await api<Overview>("/api/admin/overview")); } catch (e) { toast(e instanceof Error ? e.message : "加载失败", "error"); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  if (!data) return <div className="page-loading"><RefreshCw className="spin" /> 正在汇总边缘节点数据…</div>;
  const success = data.totals.requests ? ((1 - data.totals.errors / data.totals.requests) * 100).toFixed(1) : "100.0";
  const hour = new Date().getHours(); const greeting = hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  return <>
    <PageHeader eyebrow="OVERVIEW" title={`${greeting}，欢迎回来`} description="所有模型与密钥运行状态，都在这里一目了然。" actions={<><IconButton label="刷新数据" onClick={load}><RefreshCw size={17} className={loading ? "spin" : ""} /></IconButton><Button onClick={() => onNavigate("providers")}><Plus size={16}/> 添加渠道</Button></>} />
    {demoMode && <div className="demo-banner"><span className="demo-banner-icon"><Sparkles size={19}/></span><div><strong>这是一个可交互的演示控制台</strong><p>所有数据由模拟渠道产生。你可以放心修改配置，或前往在线调试体验真实请求流程。</p></div><Button variant="secondary" size="sm" onClick={() => onNavigate("playground")}>立即测试 <ArrowRight size={14}/></Button></div>}
    <section className="metric-grid">
      <article className="metric-card"><div className="metric-top"><span>累计请求</span><span className="metric-icon blue"><Braces size={19}/></span></div><strong>{formatNumber(data.totals.requests)}</strong><div className="metric-foot"><span className="trend-up">今日 +{data.today.requests}</span><small>全部边缘请求</small></div></article>
      <article className="metric-card"><div className="metric-top"><span>请求成功率</span><span className="metric-icon green"><CheckCircle2 size={19}/></span></div><strong>{success}<em>%</em></strong><div className="metric-foot"><span>运行稳定</span><small>{data.totals.errors} 次异常</small></div></article>
      <article className="metric-card"><div className="metric-top"><span>Token 用量</span><span className="metric-icon violet"><Zap size={19}/></span></div><strong>{formatNumber(data.totals.input_tokens + data.totals.output_tokens)}</strong><div className="metric-foot"><span>输出 {formatNumber(data.totals.output_tokens)}</span><small>输入 {formatNumber(data.totals.input_tokens)}</small></div></article>
      <article className="metric-card"><div className="metric-top"><span>可用资源</span><span className="metric-icon cyan"><Boxes size={19}/></span></div><strong>{data.counts.providers}<em> 个渠道</em></strong><div className="metric-foot"><span>{data.counts.models} 个模型</span><small>{data.counts.tokens} 个 API Key</small></div></article>
    </section>
    <section className="dashboard-grid"><article className="panel usage-panel"><header className="panel-header"><div><h2>请求趋势</h2><p>最近 7 天的调用量变化</p></div><Badge tone="info">近 7 天</Badge></header><UsageChart days={data.days}/><div className="chart-legend"><span><i className="legend-primary"/>请求次数</span><strong>总计 {formatNumber(data.days.reduce((sum, day) => sum + day.requests, 0))}</strong></div></article>
      <article className="panel quick-panel"><header className="panel-header"><div><h2>快捷操作</h2><p>常用管理入口</p></div></header><div className="quick-list"><button onClick={() => onNavigate("providers")}><span className="quick-icon"><Boxes size={19}/></span><span><strong>管理上游渠道</strong><small>添加模型与密钥池</small></span><ArrowRight size={16}/></button><button onClick={() => onNavigate("routes")}><span className="quick-icon"><Route size={19}/></span><span><strong>编排降级路由</strong><small>设置模型尝试顺序</small></span><ArrowRight size={16}/></button><button onClick={() => onNavigate("tokens")}><span className="quick-icon"><KeyRound size={19}/></span><span><strong>创建 API Key</strong><small>配置模型权限与额度</small></span><ArrowRight size={16}/></button></div><div className="endpoint-box"><span>统一接口地址</span><code>{location.origin}/v1</code></div></article>
    </section>
    <section className="dashboard-grid lower-grid"><article className="panel"><header className="panel-header"><div><h2>渠道状态</h2><p>上游资源实时概览</p></div><Button variant="ghost" size="sm" onClick={() => onNavigate("providers")}>查看全部 <ArrowRight size={14}/></Button></header><div className="provider-status-list">{data.providers.map(provider => <div key={provider.id}><span className={`provider-logo ${provider.protocol}`}>{provider.protocol === "claude" ? "C" : "O"}</span><div><strong>{provider.name}</strong><small>{provider.protocol === "claude" ? "Anthropic Claude" : "OpenAI Compatible"}</small></div><span className="provider-errors">{provider.errors ? `${provider.errors} 错误` : "无异常"}</span><Badge tone={provider.enabled ? "success" : "neutral"}>{provider.enabled ? "运行中" : "已停用"}</Badge></div>)}</div></article>
      <article className="panel"><header className="panel-header"><div><h2>最近异常</h2><p>仅记录错误，不保存正常请求</p></div><IconButton label="查看错误日志" onClick={() => onNavigate("errors")}><CircleAlert size={18}/></IconButton></header>{data.recentErrors.length ? <div className="recent-errors">{data.recentErrors.slice(0, 3).map(error => <div key={error.id}><CircleAlert size={16}/><div><strong>{error.route_model} · {error.provider_name || "未知渠道"}</strong><p>{error.message}</p><small>{formatDate(error.created_at)}</small></div></div>)}</div> : <div className="all-clear"><span><Activity size={24}/></span><strong>一切正常</strong><p>暂时没有需要处理的异常</p></div>}</article>
    </section>
  </>;
}
