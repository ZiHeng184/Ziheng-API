import { useEffect, useState } from "react";
import { Activity, CircleAlert, RefreshCw, Trash2 } from "lucide-react";
import { api, del, formatDate } from "../api";
import type { ErrorLog } from "../types";
import { Badge, Button, Empty, IconButton, PageHeader } from "../components/UI";

export default function Errors({ toast }: { toast: (message: string, type?: "success" | "error") => void }) {
  const [errors, setErrors] = useState<ErrorLog[]>([]); const [loading, setLoading] = useState(false);
  const load = async () => { setLoading(true); try { setErrors(await api<ErrorLog[]>("/api/admin/errors")); } catch (e) { toast(e instanceof Error ? e.message : "加载失败", "error"); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  return <><PageHeader eyebrow="OBSERVABILITY" title="错误日志" description="仅保留失败请求与渠道尝试明细，不保存正常对话内容。" actions={<><IconButton label="刷新" onClick={load}><RefreshCw size={16} className={loading ? "spin" : ""}/></IconButton><Button variant="secondary" disabled={!errors.length} onClick={async () => { if (confirm("确定清空全部错误日志？")) { await del("/api/admin/errors"); load(); toast("日志已清空"); } }}><Trash2 size={15}/> 清空日志</Button></>} />
    <div className="privacy-strip"><Activity size={17}/><span>隐私优先：正常请求只计入聚合统计，不保留提示词、回答或逐条调用记录。</span></div>
    <section className="panel table-panel">{errors.length ? <div className="table-scroll"><table><thead><tr><th>时间 / 请求 ID</th><th>请求模型</th><th>渠道</th><th>状态</th><th>错误详情</th><th>尝试</th></tr></thead><tbody>{errors.map(error => <tr key={error.id}><td><div className="time-cell"><span>{formatDate(error.created_at)}</span><code title={error.request_id}>{error.request_id.slice(0, 8)}</code></div></td><td><strong>{error.route_model}</strong><small className="table-subline">{error.model_name || "路由未命中"}</small></td><td>{error.provider_name || "—"}<small className="table-subline">{error.token_name || "—"}</small></td><td><Badge tone="danger">HTTP {error.status || 502}</Badge></td><td><p className="error-message" title={error.message}>{error.message}</p></td><td><span className="attempt-count">{error.attempts}</span></td></tr>)}</tbody></table></div> : <Empty icon={<CircleAlert size={28}/>} title="没有错误记录" description="当前没有失败请求。渠道出现异常时，详细原因会显示在这里。" action={<Button variant="secondary" onClick={load}><RefreshCw size={15}/> 重新检查</Button>} />}</section>
  </>;
}
