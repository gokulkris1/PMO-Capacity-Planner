/**
 * B2 interim overlays: Drawer, Dialog, ConfirmDialog (promise API), Menu, Tooltip and Toast.
 * Behaviour follows DESIGN_SYSTEM §8.11–8.19: focus trap, Escape, focus restore, no window.confirm.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Ellipsis, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { Button, IconButton, cx } from './primitives';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapTab(e: KeyboardEvent, container: HTMLElement | null) {
  if (e.key !== 'Tab' || !container) return;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (n) => n.offsetParent !== null || n === document.activeElement,
  );
  if (nodes.length === 0) {
    e.preventDefault();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Attaches a keydown listener to an element (keeps JSX free of handlers on dialog containers). */
function useElementKeydown(ref: RefObject<HTMLElement | null>, handler: (e: KeyboardEvent) => void, active: boolean) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const fn = (e: KeyboardEvent) => latest.current(e);
    el.addEventListener('keydown', fn);
    return () => el.removeEventListener('keydown', fn);
  }, [ref, active]);
}

/** Remembers the element focused when an overlay opened and restores it on close. */
function useRestoreFocus(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, [open]);
}

/* ── Drawer ──────────────────────────────────────────────────────────────────────── */

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  tabs,
  size = 'lg',
  headerExtra,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  tabs?: ReactNode;
  size?: 'sm' | 'lg';
  headerExtra?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useRestoreFocus(open);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  useElementKeydown(
    ref,
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else trapTab(e, ref.current);
    },
    open,
  );
  if (!open) return null;
  return createPortal(
    <div className="b2-layer b2-drawer-layer">
      <div className="b2-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className={cx('b2-drawer', size === 'sm' && 'b2-drawer--sm')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="b2-drawer__head">
          {headerExtra}
          <div className="b2-drawer__titles">
            <h2 className="b2-drawer__title" id={titleId}>
              {title}
            </h2>
            {subtitle && <div className="b2-caption">{subtitle}</div>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        {tabs && <div className="b2-drawer__tabs">{tabs}</div>}
        <div className="b2-drawer__body">{children}</div>
        {footer && <div className="b2-drawer__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ── Dialog ──────────────────────────────────────────────────────────────────────── */

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  alert,
  closable = true,
}: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  alert?: boolean;
  closable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useRestoreFocus(open);
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    // Confirm dialogs focus Cancel (first footer button); forms focus their first field.
    const target = alert
      ? el.querySelector<HTMLElement>('.b2-dialog__foot button')
      : el.querySelector<HTMLElement>('.b2-dialog__body ' + FOCUSABLE.split(',').join(', .b2-dialog__body '));
    (target ?? el).focus();
  }, [open, alert]);
  useElementKeydown(
    ref,
    (e) => {
      if (e.key === 'Escape' && closable) {
        e.stopPropagation();
        onClose();
      } else trapTab(e, ref.current);
    },
    open,
  );
  if (!open) return null;
  return createPortal(
    <div className="b2-layer b2-dialog-layer">
      <div className="b2-scrim" onClick={closable ? onClose : undefined} aria-hidden="true" />
      <div
        ref={ref}
        className={cx('b2-dialog', size === 'sm' && 'b2-dialog--sm', size === 'lg' && 'b2-dialog--lg')}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        <div className="b2-dialog__head">
          <h2 className="b2-dialog__title" id={titleId}>
            {title}
          </h2>
          {!alert && closable && <IconButton icon={X} label="Close" onClick={onClose} />}
        </div>
        <div className="b2-dialog__body" id={bodyId}>
          {children}
        </div>
        {footer && <div className="b2-dialog__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ── ConfirmDialog with a promise API: const ok = await confirm({...}) ───────────── */

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
}
export function useConfirm(): { confirm(o: ConfirmOptions): Promise<boolean>; dialog: ReactNode } {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );
  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };
  const dialog = (
    <Dialog
      open={!!opts}
      size="sm"
      alert
      title={opts?.title ?? ''}
      onClose={() => close(false)}
      footer={
        <>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant={opts?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
            {opts?.confirmLabel}
          </Button>
        </>
      }
    >
      {opts?.body}
    </Dialog>
  );
  return { confirm, dialog };
}

/* ── Menu ────────────────────────────────────────────────────────────────────────── */

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect(): void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}
export function Menu({
  items,
  label,
  icon = Ellipsis,
  size = 'md',
}: {
  items: MenuItem[];
  label: string;
  icon?: LucideIcon;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const place = () => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 220;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
    const below = r.bottom + 4;
    const estimated = items.length * 32 + 16;
    const top = below + estimated > window.innerHeight - 8 ? Math.max(8, r.top - estimated - 4) : below;
    setPos({ top, left });
  };
  const toggle = () => {
    if (!open) place();
    setOpen((o) => !o);
  };
  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) anchorRef.current?.querySelector<HTMLElement>('button')?.focus();
  };
  useLayoutEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node))
        setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nodes[(i + 1) % nodes.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nodes[(i - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      nodes[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      close();
    } else if (e.key.length === 1) {
      const ch = e.key.toLowerCase();
      const start = i + 1;
      const order = [...nodes.slice(start), ...nodes.slice(0, start)];
      order.find((n) => n.textContent?.trim().toLowerCase().startsWith(ch))?.focus();
    }
  };

  return (
    <span ref={anchorRef} className="b2-menu-anchor">
      <IconButton
        icon={icon}
        label={label}
        size={size}
        id={triggerId}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      />
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="b2-layer b2-menu"
            role="menu"
            aria-labelledby={triggerId}
            style={{ top: pos.top, left: pos.left }}
            onKeyDown={onKey}
            tabIndex={-1}
          >
            {items.map((it) => {
              const Icon = it.icon;
              return (
                <div key={it.label}>
                  {it.separatorBefore && <div className="b2-menu__sep" role="separator" />}
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    disabled={it.disabled}
                    className={cx('b2-menu__item', it.danger && 'b2-menu__item--danger')}
                    onClick={() => {
                      close();
                      it.onSelect();
                    }}
                  >
                    {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden="true" />}
                    {it.label}
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </span>
  );
}

/* ── Tooltip ─────────────────────────────────────────────────────────────────────── */

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const show = (delay: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setPos({ top: r.top - 8, left: r.left + r.width / 2 });
    }, delay);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setPos(null);
  };
  const handlers = useRef({ show, hide });
  useEffect(() => {
    handlers.current = { show, hide };
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const enter = () => handlers.current.show(300);
    const focus = () => handlers.current.show(0);
    const leave = () => handlers.current.hide();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handlers.current.hide();
    };
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    el.addEventListener('focusin', focus);
    el.addEventListener('focusout', leave);
    el.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
      el.removeEventListener('focusin', focus);
      el.removeEventListener('focusout', leave);
      el.removeEventListener('keydown', key);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);
  return (
    <span ref={ref} className="b2-tooltip-anchor" aria-describedby={pos ? id : undefined}>
      {children}
      {pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="b2-layer b2-tooltip"
            style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

/* ── Toast (module store; one viewport per page) ─────────────────────────────────── */

export type ToastTone = 'success' | 'info' | 'warning' | 'error';
export interface ToastInput {
  tone?: ToastTone;
  title: string;
  body?: string;
  action?: { label: string; onClick(): void };
}
interface ToastItem extends ToastInput {
  id: number;
}
let toasts: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
export function toast(t: ToastInput): number {
  const id = ++seq;
  toasts = [...toasts, { ...t, id }].slice(-3);
  emit();
  const tone = t.tone ?? 'success';
  if (tone !== 'error') window.setTimeout(() => dismissToast(id), t.action ? 8000 : 5000);
  return id;
}
const TOAST_ICON: Record<ToastTone, LucideIcon> = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
};
export function ToastViewport() {
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );
  return createPortal(
    <div className="b2-layer b2-toasts">
      {items.map((t) => {
        const tone = t.tone ?? 'success';
        const Icon = TOAST_ICON[tone];
        return (
          <div key={t.id} className={cx('b2-toast', `b2-toast--${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
            <Icon className="b2-toast__icon" size={16} strokeWidth={1.75} aria-hidden="true" />
            <div className="b2-toast__body">
              <div className="b2-toast__title">{t.title}</div>
              {t.body && <div className="b2-toast__text">{t.body}</div>}
              {t.action && (
                <Button
                  variant="link"
                  onClick={() => {
                    dismissToast(t.id);
                    t.action?.onClick();
                  }}
                >
                  {t.action.label}
                </Button>
              )}
            </div>
            <IconButton icon={X} label="Dismiss" size="sm" onClick={() => dismissToast(t.id)} />
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
