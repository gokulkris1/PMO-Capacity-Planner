import type { ReactNode, Ref, SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { Icon } from '../Icon';
import { useFieldControl } from '../FormField';
import { cx } from '../internal/utils';
import '../FormField/field.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Consecutive options with the same group render inside one <optgroup>. */
  group?: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Options; alternatively pass <option>/<optgroup> children. */
  options?: SelectOption[];
  /** Adds a first, empty option with this label (e.g. "Select a craft"). */
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
  /** Class for the outer control box. */
  className?: string;
  children?: ReactNode;
  ref?: Ref<HTMLSelectElement>;
  /** Convenience: called with the selected value (alongside the native onChange). */
  onValueChange?: (value: string) => void;
}

function groupOptions(options: SelectOption[]): Array<{ group: string | undefined; items: SelectOption[] }> {
  const out: Array<{ group: string | undefined; items: SelectOption[] }> = [];
  for (const o of options) {
    const last = out[out.length - 1];
    if (last && last.group === o.group) last.items.push(o);
    else out.push({ group: o.group, items: [o] });
  }
  return out;
}

/** Native select with a ChevronDown, for short static lists (DESIGN_SYSTEM §8.4). */
export function Select({
  options,
  placeholder,
  size = 'md',
  invalid,
  className,
  disabled,
  id,
  'aria-describedby': ariaDescribedBy,
  required,
  children,
  ref,
  onValueChange,
  onChange,
  ...rest
}: SelectProps) {
  const field = useFieldControl({ id, invalid, 'aria-describedby': ariaDescribedBy, required });
  return (
    <div
      className={cx(
        'pcp-control',
        'pcp-control--select',
        `pcp-control--${size}`,
        field['aria-invalid'] && 'pcp-control--invalid',
        disabled && 'pcp-control--disabled',
        className,
      )}
    >
      <select
        ref={ref}
        className="pcp-control__input"
        disabled={disabled}
        {...field}
        {...rest}
        onChange={(e) => {
          onChange?.(e);
          onValueChange?.(e.target.value);
        }}
      >
        {placeholder !== undefined ? (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        ) : null}
        {options
          ? groupOptions(options).map((g, gi) =>
              g.group ? (
                <optgroup key={`${g.group}-${gi}`} label={g.group}>
                  {g.items.map((o) => (
                    <option key={o.value} value={o.value} disabled={o.disabled}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ) : (
                g.items.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))
              ),
            )
          : null}
        {children}
      </select>
      <Icon icon={ChevronDown} size={16} className="pcp-control__chevron" />
    </div>
  );
}
