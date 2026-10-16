import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cx } from '../internal/utils';
import './code-input.css';

export interface CodeInputProps {
  /** Digits entered so far (string of up to `length` digits). */
  value: string;
  onChange: (value: string) => void;
  /** Called when all boxes are filled. */
  onComplete?: (value: string) => void;
  length?: number;
  /** Accessible group label, e.g. "Verification code". */
  label: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  'aria-describedby'?: string;
}

/** Six-box one-time-code input: auto-advance, backspace to previous, paste fills all (ST-07#AC2). */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  label,
  invalid,
  disabled,
  autoFocus,
  'aria-describedby': describedBy,
}: CodeInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const setAt = (i: number, d: string) => {
    const arr = [...digits];
    arr[i] = d;
    const next = arr.join('').slice(0, length);
    onChange(next);
    if (next.length === length && !next.includes('') && arr.every((x) => x !== '')) onComplete?.(next);
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
      setAt(i - 1, '');
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < length - 1) {
      e.preventDefault();
      refs.current[i + 1]?.focus();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!text) return;
    e.preventDefault();
    onChange(text);
    refs.current[Math.min(text.length, length - 1)]?.focus();
    if (text.length === length) onComplete?.(text);
  };

  return (
    <div className="pcp-code" role="group" aria-label={label} aria-describedby={describedBy}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={cx('pcp-code__box', invalid && 'pcp-code__box--invalid')}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={d}
          disabled={disabled}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- first box of a code step the user just requested
          autoFocus={autoFocus && i === 0}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(-1);
            setAt(i, v);
            if (v && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
