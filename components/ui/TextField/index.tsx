import { useState, type InputHTMLAttributes, type Ref, type TextareaHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CalendarDays, Eye, EyeOff, X } from 'lucide-react';
import { Icon } from '../Icon';
import { useFieldControl } from '../FormField';
import { cx } from '../internal/utils';
import '../FormField/field.css';

export type ControlSize = 'sm' | 'md' | 'lg';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ControlSize;
  /** Leading icon (16, tertiary), e.g. Search. */
  leadingIcon?: LucideIcon;
  /** Shows a clear button (`aria-label="Clear"`) when there is a value. */
  onClear?: () => void;
  invalid?: boolean;
  /** Class for the outer control box. */
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Single-line text input (DESIGN_SYSTEM §8.4). Use inside FormField for a bound label. */
export function TextField({
  size = 'md',
  leadingIcon,
  onClear,
  invalid,
  className,
  disabled,
  readOnly,
  id,
  ref,
  'aria-describedby': ariaDescribedBy,
  required,
  type = 'text',
  ...rest
}: TextFieldProps) {
  const field = useFieldControl({ id, invalid, 'aria-describedby': ariaDescribedBy, required });
  const hasValue = rest.value !== undefined && rest.value !== null && String(rest.value) !== '';
  return (
    <div
      className={cx(
        'pcp-control',
        `pcp-control--${size}`,
        field['aria-invalid'] && 'pcp-control--invalid',
        disabled && 'pcp-control--disabled',
        readOnly && 'pcp-control--readonly',
        className,
      )}
    >
      {leadingIcon ? <Icon icon={leadingIcon} size={16} className="pcp-control__icon" /> : null}
      <input
        ref={ref}
        type={type}
        className="pcp-control__input"
        disabled={disabled}
        readOnly={readOnly}
        {...field}
        {...rest}
      />
      {onClear && hasValue && !disabled && !readOnly ? (
        <button type="button" className="pcp-control__clear" aria-label="Clear" onClick={onClear}>
          <Icon icon={X} size={14} />
        </button>
      ) : null}
    </div>
  );
}

export interface DateFieldProps extends Omit<TextFieldProps, 'type' | 'leadingIcon' | 'onClear'> {
  /** ISO date 'YYYY-MM-DD'. */
  value?: string;
}

/** Native date input styled like TextField with a CalendarDays icon. */
export function DateField({ className, ...rest }: DateFieldProps) {
  return (
    <TextField type="date" leadingIcon={CalendarDays} className={cx('pcp-control--date', className)} {...rest} />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

/** Multi-line text input. */
export function Textarea({
  invalid,
  className,
  id,
  'aria-describedby': ariaDescribedBy,
  required,
  ref,
  ...rest
}: TextareaProps) {
  const field = useFieldControl({ id, invalid, 'aria-describedby': ariaDescribedBy, required });
  return <textarea ref={ref} className={cx('pcp-textarea', className)} {...field} {...rest} />;
}

export type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'onClear'>;

/** Password input with a Show/Hide toggle (Eye / EyeOff). */
export function PasswordField({ className, disabled, ...rest }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={cx('pcp-password', className)}>
      <TextField type={visible ? 'text' : 'password'} disabled={disabled} {...rest} />
      <button
        type="button"
        className="pcp-password__toggle"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
      >
        <Icon icon={visible ? EyeOff : Eye} size={16} />
      </button>
    </div>
  );
}
