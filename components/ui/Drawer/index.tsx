import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../Button';
import { Portal } from '../internal/Portal';
import { cx, useFocusTrap, useScrollLock } from '../internal/utils';
import './drawer.css';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** H3 title. */
  title: ReactNode;
  subtitle?: ReactNode;
  /** Leading header content, e.g. an Avatar 40. */
  headerStart?: ReactNode;
  /** Extra header actions left of the close button (e.g. an overflow Menu). */
  headerActions?: ReactNode;
  /** Tabs row under the header. */
  tabs?: ReactNode;
  children: ReactNode;
  /** Sticky footer (editing): secondary "Cancel" then primary "Save". */
  footer?: ReactNode;
  size?: 'sm' | 'lg';
  /**
   * When true, Escape/scrim ask `onRequestDiscard` first (unsaved edits). Return true to close.
   * Typical: `onRequestDiscard={() => confirm({ title: 'Discard changes?', confirmLabel: 'Discard', … })}`.
   */
  dirty?: boolean;
  onRequestDiscard?: () => Promise<boolean> | boolean;
  className?: string;
}

/**
 * Right-side drawer, 480/720 px (100% below 768), slides in over 200 ms, traps focus, Escape closes and
 * focus returns to the opener (DESIGN_SYSTEM §8.11). Reflect it in the URL with `useUrlParam('person')`.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  headerStart,
  headerActions,
  tabs,
  children,
  footer,
  size = 'sm',
  dirty,
  onRequestDiscard,
  className,
}: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, open);
  useScrollLock(open);

  const requestClose = async () => {
    if (dirty && onRequestDiscard) {
      const ok = await onRequestDiscard();
      if (!ok) return;
    }
    onClose();
  };
  const requestRef = useRef(requestClose);
  useEffect(() => {
    requestRef.current = requestClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const surfaces = document.querySelectorAll('[data-pcp-surface]');
      if (surfaces[surfaces.length - 1] !== ref.current) return;
      e.stopPropagation();
      void requestRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <Portal>
      <div className="pcp-drawer-layer">
        <div className="pcp-scrim" aria-hidden="true" onClick={() => void requestClose()} />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-pcp-surface=""
          className={cx('pcp-drawer', `pcp-drawer--${size}`, className)}
        >
          <div className="pcp-drawer__header">
            {headerStart}
            <div className="pcp-drawer__titles">
              <h2 id={titleId} className="pcp-drawer__title">
                {title}
              </h2>
              {subtitle ? <p className="pcp-drawer__subtitle">{subtitle}</p> : null}
            </div>
            <div className="pcp-drawer__header-actions">
              {headerActions}
              <IconButton icon={X} label="Close" onClick={() => void requestClose()} />
            </div>
          </div>
          {tabs ? <div className="pcp-drawer__tabs">{tabs}</div> : null}
          <div className="pcp-drawer__body">{children}</div>
          {footer ? <div className="pcp-drawer__footer">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}
