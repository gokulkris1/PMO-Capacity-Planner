import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Portal } from '../internal/Portal';
import { cx, useAnchoredPosition, type Placement } from '../internal/utils';
import './tooltip.css';

export interface TooltipProps {
  /** Tooltip text. Never put interactive or essential-only content here (DESIGN_SYSTEM §8.17). */
  content: ReactNode;
  /** The trigger: one focusable element (button, link, input). */
  children: ReactElement;
  placement?: Placement;
  /** Disable the tooltip without changing the tree. */
  disabled?: boolean;
  /** Use 'label' when the tooltip repeats the trigger's aria-label (icon buttons): no aria-describedby. */
  relation?: 'description' | 'label';
  /** Make the anchor wrapper block-level (for truncated text that spans the row). */
  block?: boolean;
}

const SHOW_DELAY = 300;

/** Dark tooltip; opens after 300 ms on hover and immediately on keyboard focus; Escape closes. */
export function Tooltip({
  content,
  children,
  placement = 'top',
  disabled,
  relation = 'description',
  block,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const pos = useAnchoredPosition(open, anchorRef, tipRef, placement, 8);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (delay: number) => {
    if (disabled || content === null || content === undefined || content === '') return;
    clear();
    if (delay === 0) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => clear, []);

  const child =
    isValidElement(children) && relation === 'description' && !disabled
      ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby': open ? id : (children.props as { 'aria-describedby'?: string })['aria-describedby'],
        })
      : children;

  return (
    <>
      <span
        ref={anchorRef}
        className={cx('pcp-tooltip-anchor', block && 'pcp-tooltip-anchor--block')}
        onMouseEnter={() => show(SHOW_DELAY)}
        onMouseLeave={hide}
        onFocus={(e) => {
          // Keyboard focus only (:focus-visible); mouse clicks should not flash the tooltip.
          const t = e.target as HTMLElement;
          if (typeof t.matches === 'function' && t.matches(':focus-visible')) show(0);
        }}
        onBlur={hide}
      >
        {child}
      </span>
      {open ? (
        <Portal>
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className={cx('pcp-tooltip', pos && 'pcp-tooltip--placed')}
            style={pos ? { top: pos.top, left: pos.left } : undefined}
          >
            {content}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
