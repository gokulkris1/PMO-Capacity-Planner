import { useId, useState, type KeyboardEvent, type Ref } from 'react';
import { CircleAlert } from 'lucide-react';
import { Icon } from '../Icon';
import { useFieldControl } from '../FormField';
import { cx } from '../internal/utils';
import '../FormField/field.css';

export interface NumberFieldProps {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Arrow-key step: 1 for %, 0.1 for FTE (DESIGN_SYSTEM §8.4). */
  step?: number;
  /** Unit suffix inside the right edge, e.g. "%" or "FTE". */
  unit?: string;
  /** Decimal places shown when not editing (defaults from step). */
  decimals?: number;
  size?: 'sm' | 'md' | 'lg';
  id?: string;
  name?: string;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  onBlur?: () => void;
  /**
   * Called with the inline error when the typed value is rejected (not a number, out of range) and with null when it
   * is accepted again, so a form can refuse to save while the field shows something it did not accept (QA-012).
   */
  onValidityChange?: (error: string | null) => void;
  ref?: Ref<HTMLInputElement>;
}

function format(v: number | null, decimals: number): string {
  if (v === null || Number.isNaN(v)) return '';
  return decimals > 0 ? v.toFixed(decimals) : String(Math.round(v));
}

/** Right-aligned numeric input with unit suffix; min/max enforced on blur with an inline error. */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  decimals,
  size = 'md',
  id,
  name,
  disabled,
  readOnly,
  invalid,
  required,
  placeholder,
  className,
  onBlur,
  onValidityChange,
  ref,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: NumberFieldProps) {
  const places = decimals ?? (step < 1 ? Math.min(2, String(step).split('.')[1]?.length ?? 1) : 0);
  const [draft, setDraft] = useState(() => format(value, places));
  const [editing, setEditing] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const setError = (e: string | null) => {
    setErrorState(e);
    onValidityChange?.(e);
  };
  const errorId = useId();
  const field = useFieldControl({
    id,
    invalid: invalid || !!error,
    'aria-describedby': [ariaDescribedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined,
    required,
  });

  const rangeText =
    min !== undefined && max !== undefined
      ? `Enter ${min}–${max}`
      : min !== undefined
        ? `Enter ${min} or more`
        : `Enter ${max} or less`;

  const commit = (text: string) => {
    const trimmed = text.trim().replace(',', '.');
    if (trimmed === '') {
      setError(required ? 'Enter a value' : null);
      if (!required) onChange(null);
      return;
    }
    const n = Number(trimmed);
    if (Number.isNaN(n)) {
      setError('Enter a number');
      return;
    }
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
      setError(rangeText);
      return;
    }
    setError(null);
    const rounded = Number(n.toFixed(places));
    onChange(rounded);
    setDraft(format(rounded, places));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const base = Number((editing ? draft : format(value, places)).replace(',', '.'));
    const current = Number.isNaN(base) ? (value ?? min ?? 0) : base;
    let next = current + (e.key === 'ArrowUp' ? step : -step);
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    next = Number(next.toFixed(places));
    setDraft(format(next, places));
    setError(null);
    onChange(next);
  };

  return (
    <div className={cx('pcp-number-field', className)}>
      <div
        className={cx(
          'pcp-control',
          'pcp-control--number',
          `pcp-control--${size}`,
          field['aria-invalid'] && 'pcp-control--invalid',
          disabled && 'pcp-control--disabled',
          readOnly && 'pcp-control--readonly',
        )}
      >
        <input
          ref={ref}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="pcp-control__input"
          value={editing || error ? draft : format(value, places)}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          aria-label={ariaLabel}
          {...field}
          onFocus={() => {
            setDraft(format(value, places));
            setEditing(true);
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setEditing(false);
            commit(draft);
            onBlur?.();
          }}
        />
        {unit ? <span className="pcp-control__suffix">{unit}</span> : null}
      </div>
      {error ? (
        <p id={errorId} className="pcp-control-error">
          <Icon icon={CircleAlert} size={12} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
