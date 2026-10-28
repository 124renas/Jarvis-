import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import { useApp } from "../lib/store";

export function Sheet({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not(.sheet-close)");
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`sheet glass ${wide ? "sheet-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange(v: boolean): void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle" aria-hidden="true" />
    </label>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?(): void }) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          <Icon name="refresh" size={18} /> Retry
        </button>
      )}
    </div>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function ConfirmHost() {
  const { confirmRequest: req } = useApp();
  if (!req) return null;
  return (
    <Sheet title={req.title} onClose={() => req.resolve(false)}>
      {req.body && <p className="muted">{req.body}</p>}
      <div className="row-end">
        <button type="button" className="btn ghost" onClick={() => req.resolve(false)}>
          Cancel
        </button>
        <button type="button" className={`btn ${req.danger ? "danger" : "primary"}`} onClick={() => req.resolve(true)}>
          {req.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </Sheet>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">JARVIS</p>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
