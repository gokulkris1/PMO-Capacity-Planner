import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { Icon } from '../Icon';
import { useFieldControl } from '../FormField';
import { Portal } from '../internal/Portal';
import { cx, useAnchoredPosition, useOutsideClick } from '../internal/utils';
import '../FormField/field.css';
import '../Menu/menu.css';
import './combobox.css';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary text (job title, tribe). */
  description?: string;
  /** Leading visual (Avatar 24 or CraftChip). */
  leading?: ReactNode;
  /** Group heading (overline). Options with the same group are listed together. */
  group?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  /** Show a clear button when a value is selected. */
  clearable?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
  'aria-describedby'?: string;
  className?: string;
  /** Text when nothing matches (default "No matches"). */
  emptyText?: string;
}

/**
 * Type-ahead picker for people, projects, crafts and tribes (DESIGN_SYSTEM §8.4): role="combobox",
 * aria-expanded, aria-activedescendant, listbox popover with group headings.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  id,
  disabled,
  invalid,
  required,
  clearable,
  size = 'md',
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  className,
  emptyText = 'No matches',
}: ComboboxProps) {
  const field = useFieldControl({ id, invalid, 'aria-describedby': ariaDescribedBy, required });
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pos = useAnchoredPosition(open, anchorRef, listRef, 'bottom-start', 4);
  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.description ?? '').toLowerCase().includes(q))
      : options;
    // Keep groups together in first-seen order.
    const order: string[] = [];
    for (const o of list) if (!order.includes(o.group ?? '')) order.push(o.group ?? '');
    return order.flatMap((g) => list.filter((o) => (o.group ?? '') === g));
  }, [options, query]);

  useOutsideClick([anchorRef, listRef], open, () => {
    setOpen(false);
    setQuery('');
  });

  const choose = (o: ComboboxOption) => {
    if (o.disabled) return;
    onChange(o.value);
    setOpen(false);
    setQuery('');
    inputRef.current?.focus();
  };

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    const idx = filtered.findIndex((o) => o.value === value);
    setActive(idx >= 0 ? idx : 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      else setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) {
        e.preventDefault();
        choose(filtered[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQuery('');
      }
    } else if (e.key === 'Home' && open) {
      setActive(0);
    } else if (e.key === 'End' && open) {
      setActive(filtered.length - 1);
    }
  };

  const activeId = open && filtered[active] ? `${listId}-opt-${active}` : undefined;

  return (
    <div className={cx('pcp-combobox', className)}>
      <div
        ref={anchorRef}
        className={cx(
          'pcp-control',
          `pcp-control--${size}`,
          field['aria-invalid'] && 'pcp-control--invalid',
          disabled && 'pcp-control--disabled',
        )}
      >
        {selected?.leading && !open ? <span className="pcp-combobox__leading">{selected.leading}</span> : null}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label={ariaLabel}
          autoComplete="off"
          className="pcp-control__input"
          placeholder={selected ? selected.label : placeholder}
          value={open ? query : (selected?.label ?? '')}
          disabled={disabled}
          {...field}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            if (!open) setOpen(true);
          }}
          onClick={() => (open ? undefined : openList())}
          onKeyDown={onKeyDown}
        />
        {clearable && selected && !disabled ? (
          <button
            type="button"
            className="pcp-control__clear"
            aria-label="Clear selection"
            onClick={() => {
              onChange(null);
              inputRef.current?.focus();
            }}
          >
            <Icon icon={X} size={14} />
          </button>
        ) : null}
        <Icon icon={ChevronDown} size={16} className="pcp-control__icon" />
      </div>
      {open ? (
        <Portal>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            className={cx('pcp-menu', 'pcp-combobox__list', pos && 'pcp-menu--placed')}
            style={pos ? { top: pos.top, left: pos.left, minWidth: pos.minWidth } : undefined}
          >
            {filtered.length === 0 ? <div className="pcp-combobox__empty">{emptyText}</div> : null}
            {filtered.map((o, i) => {
              const heading = o.group && o.group !== filtered[i - 1]?.group ? o.group : null;
              return (
                <div key={o.value} role="presentation">
                  {heading ? (
                    <div className="pcp-combobox__group" role="presentation">
                      {heading}
                    </div>
                  ) : null}
                  <div
                    id={`${listId}-opt-${i}`}
                    role="option"
                    aria-selected={o.value === value}
                    aria-disabled={o.disabled || undefined}
                    tabIndex={-1}
                    className={cx(
                      'pcp-combobox__option',
                      i === active && 'pcp-combobox__option--active',
                      o.disabled && 'pcp-combobox__option--disabled',
                    )}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                    // Keyboard selection happens on the input (aria-activedescendant).
                    onKeyDown={() => undefined}
                  >
                    {o.leading}
                    <span className="pcp-menu__text">
                      <span className="pcp-menu__label">{o.label}</span>
                      {o.description ? <span className="pcp-menu__desc">{o.description}</span> : null}
                    </span>
                    {o.value === value ? <Icon icon={Check} size={16} className="pcp-menu__check" /> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Portal>
      ) : null}
    </div>
  );
}
