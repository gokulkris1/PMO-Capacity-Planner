import type { QuarterView } from '../../../utils/viewModels/types';
import { Select } from '../Select';

export interface QuarterPickerProps {
  /** From useQuarters() in state/. */
  quarters: QuarterView[];
  /** Quarter key ('2026-Q4') or 'window'. */
  value: string;
  onChange: (value: string) => void;
  /** Include the "Window" (QBR1–4) option. */
  includeWindow?: boolean;
  /** Prefer fiscal labels (Settings › Planning). */
  fiscal?: boolean;
  size?: 'sm' | 'md';
  id?: string;
  'aria-label'?: string;
  className?: string;
}

/** Select of the four rolling quarters ("QBR1 · Q4 2026") plus "Window" (DESIGN_SYSTEM §8.4). */
export function QuarterPicker({
  quarters,
  value,
  onChange,
  includeWindow = true,
  fiscal,
  size = 'md',
  id,
  'aria-label': ariaLabel,
  className,
}: QuarterPickerProps) {
  const options = quarters.map((q) => ({
    value: q.key,
    label: `${q.label} · ${fiscal ? q.fiscalLabel : q.calendarLabel}`,
  }));
  if (includeWindow && quarters.length) {
    const first = quarters[0];
    const last = quarters[quarters.length - 1];
    options.push({
      value: 'window',
      label: `Window · ${fiscal ? first.fiscalLabel : first.calendarLabel} – ${fiscal ? last.fiscalLabel : last.calendarLabel}`,
    });
  }
  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      size={size}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
      className={className}
    />
  );
}
