import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, type LucideIcon } from 'lucide-react';
import { Icon } from '../Icon';
import { Portal } from '../internal/Portal';
import { cx, useAnchoredPosition, useOutsideClick, type Placement } from '../internal/utils';
import './menu.css';

export type MenuItem =
  | {
      type?: 'item';
      id: string;
      label: string;
      icon?: LucideIcon;
      /** Called on Enter/click. Use `to` for navigation instead. */
      onSelect?: () => void;
      /** Router path to navigate to. */
      to?: string;
      /** External URL (opens in a new tab). */
      href?: string;
      /** Destructive item: danger text, separated by a divider. */
      danger?: boolean;
      disabled?: boolean;
      /** Shortcut hint shown right-aligned in tertiary. */
      shortcut?: string;
      /** Secondary line (e.g. role caption in the workspace switcher). */
      description?: string;
      /** Shows a check mark (selected option). */
      selected?: boolean;
    }
  | { type: 'separator'; id: string }
  | { type: 'header'; id: string; label: string; description?: string };

export interface MenuProps {
  /** The trigger element (Button or IconButton). It receives aria-haspopup/expanded/controls and onClick. */
  trigger: ReactElement;
  items: MenuItem[];
  /** Accessible name of the menu (defaults to the trigger's label). */
  label?: string;
  placement?: Placement;
  /** Minimum width in px (defaults to 180). */
  minWidth?: number;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}

type ActionItem = Extract<MenuItem, { type?: 'item' }>;
const isAction = (i: MenuItem): i is ActionItem => i.type === undefined || i.type === 'item';

/**
 * Dropdown/overflow menu (DESIGN_SYSTEM §8.19): role="menu", arrow keys, Home/End, type-ahead,
 * Escape returns focus to the trigger.
 */
export function Menu({
  trigger,
  items,
  label,
  placement = 'bottom-end',
  minWidth = 180,
  className,
  onOpenChange,
}: MenuProps) {
  const [open, setOpenState] = useState(false);
  const [active, setActive] = useState(-1);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef<{ text: string; t: number | null }>({ text: '', t: null });
  const menuId = useId();
  const navigate = useNavigate();
  const pos = useAnchoredPosition(open, anchorRef, menuRef, placement, 4);
  const actionable = items.map((it, i) => ({ it, i })).filter(({ it }) => isAction(it) && !it.disabled);

  const setOpen = useCallback(
    (v: boolean) => {
      setOpenState(v);
      onOpenChange?.(v);
    },
    [onOpenChange],
  );

  const focusTrigger = () => {
    const el = anchorRef.current?.querySelector<HTMLElement>('button, a, [tabindex]');
    el?.focus();
  };

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setActive(-1);
    if (restoreFocus) focusTrigger();
  };

  useOutsideClick([anchorRef, menuRef], open, () => close(false));

  useEffect(() => {
    if (!open || active < 0) return;
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.focus();
  }, [open, active, pos]);

  const openWith = (which: 'first' | 'last') => {
    setOpen(true);
    const target = which === 'first' ? actionable[0] : actionable[actionable.length - 1];
    setActive(target ? target.i : -1);
  };

  const select = (item: ActionItem) => {
    close(true);
    if (item.to) navigate(item.to);
    else if (item.href) window.open(item.href, '_blank', 'noopener,noreferrer');
    item.onSelect?.();
  };

  const move = (delta: 1 | -1) => {
    if (actionable.length === 0) return;
    const pos = actionable.findIndex((a) => a.i === active);
    const next = actionable[(pos + delta + actionable.length) % actionable.length];
    setActive(next.i);
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        return;
      case 'Home':
        e.preventDefault();
        if (actionable[0]) setActive(actionable[0].i);
        return;
      case 'End':
        e.preventDefault();
        if (actionable.length) setActive(actionable[actionable.length - 1].i);
        return;
      case 'Escape':
        e.preventDefault();
        close(true);
        return;
      case 'Tab':
        close(false);
        return;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const ta = typeahead.current;
          if (ta.t !== null) window.clearTimeout(ta.t);
          ta.text += e.key.toLowerCase();
          ta.t = window.setTimeout(() => {
            ta.text = '';
          }, 500);
          const match = actionable.find(({ it }) => (it as ActionItem).label.toLowerCase().startsWith(ta.text));
          if (match) setActive(match.i);
        }
    }
  };

  // Only ARIA attributes are cloned onto the trigger; clicks and keys bubble to the anchor span below.
  const triggerEl = isValidElement(trigger)
    ? cloneElement(
        trigger as ReactElement<{ 'aria-haspopup'?: string; 'aria-expanded'?: boolean; 'aria-controls'?: string }>,
        { 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? menuId : undefined },
      )
    : trigger;

  const onAnchorClick = () => {
    if (open) close(false);
    else openWith('first');
  };
  const onAnchorKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openWith('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openWith('last');
    }
  };

  const triggerLabel =
    label ??
    ((trigger.props as { label?: string; 'aria-label'?: string }).label ||
      (trigger.props as { 'aria-label'?: string })['aria-label']);

  return (
    <>
      <span
        ref={anchorRef}
        className="pcp-menu-anchor"
        role="presentation"
        onClick={onAnchorClick}
        onKeyDown={onAnchorKeyDown}
      >
        {triggerEl}
      </span>
      {open ? (
        <Portal>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={triggerLabel}
            tabIndex={-1}
            className={cx('pcp-menu', pos && 'pcp-menu--placed', className)}
            style={pos ? { top: pos.top, left: pos.left, minWidth } : { minWidth }}
            onKeyDown={onMenuKeyDown}
          >
            {items.map((item, index) => {
              if (item.type === 'separator')
                return <div key={item.id} role="separator" className="pcp-menu__separator" />;
              if (item.type === 'header')
                return (
                  <div key={item.id} className="pcp-menu__header" role="presentation">
                    <span className="pcp-menu__header-label">{item.label}</span>
                    {item.description ? <span className="pcp-menu__header-desc">{item.description}</span> : null}
                  </div>
                );
              const needsDivider =
                item.danger && index > 0 && items[index - 1].type !== 'separator' && !items[index - 1].type
                  ? !(items[index - 1] as ActionItem).danger
                  : false;
              return (
                <MenuRow
                  key={item.id}
                  item={item}
                  index={index}
                  active={index === active}
                  divider={needsDivider}
                  onHover={() => !item.disabled && setActive(index)}
                  onSelect={() => select(item)}
                />
              );
            })}
          </div>
        </Portal>
      ) : null}
    </>
  );
}

function MenuRow({
  item,
  index,
  active,
  divider,
  onHover,
  onSelect,
}: {
  item: ActionItem;
  index: number;
  active: boolean;
  divider: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <>
      {divider ? <div role="separator" className="pcp-menu__separator" /> : null}
      <button
        type="button"
        role={item.selected !== undefined ? 'menuitemradio' : 'menuitem'}
        aria-checked={item.selected !== undefined ? item.selected : undefined}
        tabIndex={active ? 0 : -1}
        data-index={index}
        disabled={item.disabled}
        className={cx('pcp-menu__item', item.danger && 'pcp-menu__item--danger', active && 'pcp-menu__item--active')}
        onMouseEnter={onHover}
        onClick={onSelect}
      >
        {item.icon ? <Icon icon={item.icon} size={16} className="pcp-menu__icon" /> : null}
        <span className="pcp-menu__text">
          <span className="pcp-menu__label">{item.label}</span>
          {item.description ? <span className="pcp-menu__desc">{item.description}</span> : null}
        </span>
        {item.shortcut ? <span className="pcp-menu__shortcut">{item.shortcut}</span> : null}
        {item.selected ? <Icon icon={Check} size={16} className="pcp-menu__check" /> : null}
      </button>
    </>
  );
}

/** Small popover surface for non-menu content (notifications list, filters). Same chrome as Menu. */
export function Popover({
  trigger,
  children,
  label,
  placement = 'bottom-end',
  width = 360,
  open,
  onOpenChange,
}: {
  trigger: ReactElement;
  children: ReactNode;
  label: string;
  placement?: Placement;
  width?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const pos = useAnchoredPosition(open, anchorRef, panelRef, placement, 4);
  useOutsideClick([anchorRef, panelRef], open, () => onOpenChange(false));
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
        anchorRef.current?.querySelector<HTMLElement>('button')?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);
  const triggerEl = cloneElement(
    trigger as ReactElement<{
      onClick?: () => void;
      'aria-expanded'?: boolean;
      'aria-controls'?: string;
      'aria-haspopup'?: string;
    }>,
    {
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      'aria-controls': open ? id : undefined,
      onClick: () => onOpenChange(!open),
    },
  );
  return (
    <>
      <span ref={anchorRef} className="pcp-menu-anchor">
        {triggerEl}
      </span>
      {open ? (
        <Portal>
          <div
            ref={panelRef}
            id={id}
            role="dialog"
            aria-label={label}
            className={cx('pcp-menu', 'pcp-popover', pos && 'pcp-menu--placed')}
            style={pos ? { top: pos.top, left: pos.left, width } : { width }}
          >
            {children}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
