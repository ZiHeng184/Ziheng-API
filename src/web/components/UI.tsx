import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, LoaderCircle, X } from "lucide-react";
import type { ToastItem } from "../types";

export function Button({ children, variant = "primary", size = "md", loading, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean }) {
  return <button className={`btn btn-${variant} btn-${size} ${className}`} {...props} disabled={loading || props.disabled}>
    {loading && <LoaderCircle size={15} className="spin" />}{children}
  </button>;
}

export function IconButton({ label, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button className={`icon-btn ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "success" | "danger" | "warning" | "info" | "neutral" | "purple" }) {
  return <span className={`badge badge-${tone}`}><span className="badge-dot" />{children}</span>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "is-on" : ""}`} onClick={() => onChange(!checked)}><span /></button>;
}

export function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}{required && <em>*</em>}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input className="input" {...props} />; }
export function Select({ children, className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className={`select-wrap ${className}`}><select className="input select" {...props}>{children}</select><ChevronDown size={15} /></span>;
}

export function Modal({ title, description, children, onClose, wide = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><IconButton label="关闭" onClick={onClose}><X size={19} /></IconButton></header>
      <div className="modal-body">{children}</div>
    </section>
  </div>;
}

export function Empty({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Toasts({ items, dismiss }: { items: ToastItem[]; dismiss: (id: number) => void }) {
  return <div className="toasts">{items.map(item => <div className={`toast toast-${item.type}`} key={item.id}>
    {item.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}<span>{item.message}</span><button onClick={() => dismiss(item.id)}><X size={15} /></button>
  </div>)}</div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}
