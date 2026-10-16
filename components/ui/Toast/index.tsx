import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { Icon } from '../Icon';
import { Button } from '../Button';
import { Portal } from '../internal/Portal';
import { cx } from '../internal/utils';
import './toast.css';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastOptions {
  tone?: ToastTone;
  title: string;
  body?: ReactNode;
  /** Single action, e.g. { label: 'Undo', onAction: () => undo() }. Extends the duration to 8 s. */
  action?: { label: string; onAction: () => void };
  /** Milliseconds; defaults: success/info 5000, with action 8000, error persistent (0). */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'tone' | 'title'>> {
  id: number;
  body?: ReactNode;
  action?: ToastOptions['action'];
  duration: number;
}

export interface ToastApi {
  show(opts: ToastOptions): number;
  success(title: string, opts?: Omit<ToastOptions, 'title' | 'tone'>): number;
  info(title: string, opts?: Omit<ToastOptions, 'title' | 'tone'>): number;
  warning(title: string, opts?: Omit<ToastOptions, 'title' | 'tone'>): number;
  /** Error toast; persistent until closed. Never pass raw server text (use errorToastText). */
  error(title: string, opts?: Omit<ToastOptions, 'title' | 'tone'>): number;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Record<ToastTone, LucideIcon> = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
};

const MAX_VISIBLE = 3;

/** Generic error copy with the request reference (DS-03#AC6). */
export function errorToastText(requestId?: string | null): string {
  return requestId
    ? `Something went wrong. Try again, or quote reference ${requestId}.`
    : 'Something went wrong. Try again.';
}

/** Mount once near the root (AppProviders does this). Toasts stack bottom-left, max 3 visible. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback((opts: ToastOptions) => {
    seq.current += 1;
    const id = seq.current;
    const tone = opts.tone ?? 'info';
    const duration = opts.duration ?? (tone === 'error' ? 0 : opts.action ? 8000 : 5000);
    setItems((list) => [...list, { id, tone, title: opts.title, body: opts.body, action: opts.action, duration }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, o) => show({ ...o, title, tone: 'success' }),
      info: (title, o) => show({ ...o, title, tone: 'info' }),
      warning: (title, o) => show({ ...o, title, tone: 'warning' }),
      error: (title, o) => show({ ...o, title, tone: 'error' }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Portal>
        <div className="pcp-toasts">
          {items.map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
      </Portal>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (item.duration <= 0 || paused) return;
    startedAt.current = Date.now();
    const t = window.setTimeout(() => dismissRef.current(), remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, item.duration]);

  return (
    <div
      className={cx('pcp-toast', `pcp-toast--${item.tone}`)}
      role={item.tone === 'error' ? 'alert' : 'status'}
      aria-live={item.tone === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="pcp-toast__icon">
        <Icon icon={TONE_ICON[item.tone]} size={16} />
      </span>
      <div className="pcp-toast__content">
        <p className="pcp-toast__title">{item.title}</p>
        {item.body ? <div className="pcp-toast__body">{item.body}</div> : null}
        {item.action ? (
          <div className="pcp-toast__action">
            <Button
              variant="link"
              onClick={() => {
                item.action?.onAction();
                onDismiss();
              }}
            >
              {item.action.label}
            </Button>
          </div>
        ) : null}
      </div>
      <button type="button" className="pcp-toast__close" aria-label="Dismiss notification" onClick={onDismiss}>
        <Icon icon={X} size={16} />
      </button>
    </div>
  );
}

/** Toast API: `const toast = useToast(); toast.success('Saved')`. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast() needs <ToastProvider> (mounted by AppProviders).');
  return ctx;
}
