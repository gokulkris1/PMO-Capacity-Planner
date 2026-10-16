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
      <select ref={ref} className="pcp-control__input" disabled={disabled} {...field} {...rest}>
        {placeholder !== undefined ? (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        ) : null}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <Icon icon={ChevronDown} size={16} className="pcp-control__chevron" />
    </div>
  );
}
