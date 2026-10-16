import { createContext, useContext, useId, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { Icon } from '../Icon';
import { cx } from '../internal/utils';
import './field.css';

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Controls (TextField, NumberField, Select, DateField, Textarea, Combobox) read the id, aria-describedby
 * and invalid state from the surrounding FormField, so `<label for>` always matches (DS-02#AC2).
 */
export function useFieldControl(props: {
  id?: string;
  invalid?: boolean;
  'aria-describedby'?: string;
  required?: boolean;
}): { id: string; 'aria-describedby': string | undefined; 'aria-invalid': true | undefined; required?: boolean } {
  const ctx = useContext(FieldContext);
  const fallback = useId();
  const id = props.id ?? ctx?.id ?? fallback;
  const describedBy = [props['aria-describedby'], ctx?.describedBy].filter(Boolean).join(' ') || undefined;
  const invalid = props.invalid ?? ctx?.invalid ?? false;
  return {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': invalid ? true : undefined,
    required: props.required ?? ctx?.required ?? undefined,
  };
}

export interface FormFieldProps {
  label: ReactNode;
  children: ReactNode;
  /** Helper text below the control (caption, tertiary). */
  help?: ReactNode;
  /** Error message; marks the control invalid and links it via aria-describedby. */
  error?: ReactNode;
  /** Adds the "(optional)" suffix. Required fields carry no suffix (DESIGN_SYSTEM §12.5). */
  optional?: boolean;
  required?: boolean;
  /** Explicit control id; otherwise one is generated. */
  id?: string;
  /** Visually hide the label (it stays available to assistive tech). */
  hideLabel?: boolean;
  className?: string;
  /** Extra content on the label row (e.g. a help IconButton). */
  labelAside?: ReactNode;
}

/** Label above the control (12/16/600), help and error captions below (DESIGN_SYSTEM §8.4). */
export function FormField({
  label,
  children,
  help,
  error,
  optional,
  required,
  id,
  hideLabel,
  className,
  labelAside,
}: FormFieldProps) {
  const generated = useId();
  const controlId = id ?? `f${generated}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: !!error, required: !!required }}>
      <div className={cx('pcp-field', className)}>
        <div className={cx('pcp-field__label-row', hideLabel && 'pcp-sr-only')}>
          <label className="pcp-field__label" htmlFor={controlId}>
            {label}
            {optional ? <span className="pcp-field__optional"> (optional)</span> : null}
          </label>
          {labelAside}
        </div>
        {children}
        {error ? (
          <p id={errorId} className="pcp-field__error">
            <Icon icon={CircleAlert} size={12} />
            <span>{error}</span>
          </p>
        ) : null}
        {help ? (
          <p id={helpId} className="pcp-field__help">
            {help}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/** Groups related fields under a heading with an optional description (settings sections, dialogs). */
export function Fieldset({
  legend,
  description,
  children,
  className,
}: {
  legend: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cx('pcp-fieldset', className)}>
      <legend className="pcp-fieldset__legend">{legend}</legend>
      {description ? <p className="pcp-fieldset__description">{description}</p> : null}
      <div className="pcp-fieldset__body">{children}</div>
    </fieldset>
  );
}
