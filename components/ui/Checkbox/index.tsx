import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react';
import { Check, Minus } from 'lucide-react';
import { Icon } from '../Icon';
import { cx, mergeRefs } from '../internal/utils';
import './checkbox.css';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label to the right (the whole row is clickable). Omit only with `aria-label`. */
  label?: ReactNode;
  /** Helper text under the label. */
  description?: ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  'aria-label'?: string;
  ref?: Ref<HTMLInputElement>;
}

/** 16 px checkbox with primary fill and Check/Minus glyph (DESIGN_SYSTEM §8.4). */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  indeterminate = false,
  disabled,
  id,
  name,
  className,
  ref,
  'aria-label': ariaLabel,
}: CheckboxProps) {
  const inner = useRef<HTMLInputElement>(null);
  const gen = useId();
  const inputId = id ?? gen;
  const descId = description ? `${inputId}-desc` : undefined;
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <div className={cx('pcp-check', disabled && 'pcp-check--disabled', className)}>
      <span className="pcp-check__box-wrap">
        <input
          ref={mergeRefs(inner, ref)}
          id={inputId}
          name={name}
          type="checkbox"
          className="pcp-check__input"
          checked={checked}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-describedby={descId}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="pcp-check__box" aria-hidden="true">
          {indeterminate ? <Icon icon={Minus} size={12} /> : checked ? <Icon icon={Check} size={12} /> : null}
        </span>
      </span>
      {label ? (
        <span className="pcp-check__text">
          <label htmlFor={inputId} className="pcp-check__label">
            {label}
          </label>
          {description ? (
            <span id={descId} className="pcp-check__description">
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Hide the visible label (still used as the accessible name). */
  hideLabel?: boolean;
}

/** role="switch" toggle: 32×18 track, 14 px knob (DESIGN_SYSTEM §8.4). */
export function Switch({ checked, onChange, label, description, disabled, id, className, hideLabel }: SwitchProps) {
  const gen = useId();
  const switchId = id ?? gen;
  const labelId = `${switchId}-label`;
  const descId = description ? `${switchId}-desc` : undefined;
  return (
    <div className={cx('pcp-switch', disabled && 'pcp-switch--disabled', className)}>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descId}
        disabled={disabled}
        className="pcp-switch__track"
        onClick={() => onChange(!checked)}
      >
        <span className="pcp-switch__knob" aria-hidden="true" />
      </button>
      <span className={cx('pcp-check__text', hideLabel && 'pcp-sr-only')}>
        {/* The label is associated through aria-labelledby; clicking it toggles via the button. */}
        <span id={labelId} className="pcp-check__label pcp-switch__label">
          {label}
        </span>
        {description ? (
          <span id={descId} className="pcp-check__description">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Group label (rendered as a legend). */
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  name?: string;
  hideLabel?: boolean;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}

/** Native radios in a fieldset; arrow keys move selection (browser behaviour). */
export function RadioGroup({
  label,
  value,
  onChange,
  options,
  name,
  hideLabel,
  orientation = 'vertical',
  className,
}: RadioGroupProps) {
  const gen = useId();
  const groupName = name ?? gen;
  return (
    <fieldset className={cx('pcp-radio-group', `pcp-radio-group--${orientation}`, className)}>
      <legend className={cx('pcp-field__label', hideLabel && 'pcp-sr-only')}>{label}</legend>
      <div className="pcp-radio-group__options">
        {options.map((o) => {
          const optId = `${groupName}-${o.value}`;
          return (
            <div key={o.value} className={cx('pcp-check', o.disabled && 'pcp-check--disabled')}>
              <span className="pcp-check__box-wrap">
                <input
                  id={optId}
                  type="radio"
                  name={groupName}
                  value={o.value}
                  checked={value === o.value}
                  disabled={o.disabled}
                  className="pcp-check__input"
                  aria-describedby={o.description ? `${optId}-desc` : undefined}
                  onChange={() => onChange(o.value)}
                />
                <span className="pcp-check__box pcp-check__box--radio" aria-hidden="true" />
              </span>
              <span className="pcp-check__text">
                <label htmlFor={optId} className="pcp-check__label">
                  {o.label}
                </label>
                {o.description ? (
                  <span id={`${optId}-desc`} className="pcp-check__description">
                    {o.description}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
