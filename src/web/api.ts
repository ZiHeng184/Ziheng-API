export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
    credentials: "same-origin"
  });
  const data = await response.json<any>().catch(() => null);
  if (!response.ok || data?.success === false) {
    if (response.status === 401 && path !== "/api/auth/login") window.dispatchEvent(new Event("ziheng:unauthorized"));
    throw new ApiError(data?.error?.message || `请求失败 (${response.status})`, response.status);
  }
  return data?.data as T;
}

export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

export function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat("zh-CN", { notation: (value || 0) > 99999 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value || 0);
}
export function formatDate(value: string | null | undefined, withTime = true) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(new Date(value));
}
