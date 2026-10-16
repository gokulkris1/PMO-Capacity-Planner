import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton } from '../Button';
import { Portal } from '../internal/Portal';
import { cx, useFocusTrap, useScrollLock } from '../internal/utils';
import './dialog.css';

export interface DialogProps {
  open: boolean;
  /** Called on Escape, scrim click (unless `dismissible` is false) and the close button. */
  onClose: () => void;
  title: ReactNode;
  /** Optional caption under the title. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Footer actions, right-aligned; primary/danger rightmost. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Confirmations use role="alertdialog" and omit the close button. */
  role?: 'dialog' | 'alertdialog';
  /** When false, Escape and scrim clicks do nothing (in-progress saves). */
  dismissible?: boolean;
  /** Hide the X close button. */
  hideClose?: boolean;
  className?: string;
}

/**
 * Modal dialog (DESIGN_SYSTEM §8.12): focus trap, Escape and scrim close, focus restored to the opener,
 * aria-modal, aria-labelledby (title) and aria-describedby (body). Mark the element to focus first with
 * `data-autofocus`.
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  role = 'dialog',
  dismissible = true,
  hideClose,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useFocusTrap(ref, open);
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        // Only the top-most surface handles Escape.
        const surfaces = document.querySelectorAll('[data-pcp-surface]');
        if (surfaces[surfaces.length - 1] !== ref.current) return;
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);

  if (!open) return null;
  return (
    <Portal>
      <div className="pcp-dialog-layer">
        <div
          className="pcp-scrim"
          aria-hidden="true"
          onClick={() => {
            if (dismissible && role !== 'alertdialog') onClose();
          }}
        />
        <div
          ref={ref}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          tabIndex={-1}
          data-pcp-surface=""
          className={cx('pcp-dialog', `pcp-dialog--${size}`, className)}
        >
          <div className="pcp-dialog__header">
            <div className="pcp-dialog__titles">
              <h2 id={titleId} className="pcp-dialog__title">
                {title}
              </h2>
              {subtitle ? <p className="pcp-dialog__subtitle">{subtitle}</p> : null}
            </div>
            {!hideClose && role !== 'alertdialog' ? (
              <IconButton icon={X} label="Close" onClick={onClose} noTooltip className="pcp-dialog__close" />
            ) : null}
          </div>
          <div id={bodyId} className="pcp-dialog__body">
            {children}
          </div>
          {footer ? <div className="pcp-dialog__footer">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}

/** Alias: "Modal" in the B2 brief. */
export const Modal = Dialog;

export interface ConfirmOptions {
  /** States the action and object: "Delete Maria Kelly?" Never "Are you sure?". */
  title: string;
  /** The consequence in one or two sentences. */
  body?: ReactNode;
  /** The verb, e.g. "Delete". Never "OK" or "Yes". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  /** Require typing this text to enable the confirm button (e.g. a workspace name). */
  requireText?: string;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Shows a spinner on the confirm button and blocks dismissal. */
  busy?: boolean;
}

/** Confirmation: role="alertdialog", initial focus on Cancel, danger or primary verb button. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  requireText,
  onConfirm,
  onCancel,
  busy,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const blocked = requireText !== undefined && typed.trim() !== requireText;
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      role="alertdialog"
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy} data-autofocus={requireText ? undefined : ''}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={busy}
            disabled={blocked}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body ? <div className="pcp-dialog__text">{body}</div> : null}
      {requireText !== undefined ? (
        <div className="pcp-dialog__confirm-text">
          <label htmlFor={inputId} className="pcp-field__label">
            Type <strong>{requireText}</strong> to confirm
          </label>
          <input
            id={inputId}
            className="pcp-dialog__confirm-input"
            value={typed}
            autoComplete="off"
            data-autofocus=""
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      ) : null}
    </Dialog>
  );
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Mount once near the root (AppProviders does this). Enables `useConfirm()`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; nonce: number } | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback<ConfirmFn>((opts) => {
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setState({ opts, nonce: Date.now() });
    });
  }, []);
  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state ? (
        <ConfirmDialog
          key={state.nonce}
          open
          {...state.opts}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

/**
 * Promise API replacing window.confirm (DESIGN_SYSTEM §8.12):
 * `const ok = await confirm({ title: 'Delete Maria Kelly?', body: '…', confirmLabel: 'Delete', tone: 'danger' })`.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm() needs <ConfirmProvider> (mounted by AppProviders).');
  return ctx;
}
