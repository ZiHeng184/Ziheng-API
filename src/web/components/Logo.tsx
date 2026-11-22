export function Logo({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M9 11h22L13 29h18" /><circle cx="30" cy="11" r="2.5" /></svg></span>{!compact && <span className="brand-copy"><strong>Ziheng API</strong><small>PERSONAL AI GATEWAY</small></span>}</div>;
}
