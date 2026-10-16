import { LoaderCircle } from 'lucide-react';
import { Icon } from '../Icon';
import { cx } from '../internal/utils';

export interface SpinnerProps {
  size?: 16 | 20;
  /** Visually hidden status text, e.g. "Loading people". Omit when the parent already announces it. */
  label?: string;
  className?: string;
}

/** Inline spinner for buttons and small loads. Pages use Skeleton instead (DESIGN_SYSTEM §8.16). */
export function Spinner({ size = 16, label, className }: SpinnerProps) {
  return (
    <span className={cx('pcp-spinner', className)} role={label ? 'status' : undefined}>
      <Icon icon={LoaderCircle} size={size} className="pcp-icon--spin" />
      {label ? <span className="pcp-sr-only">{label}</span> : null}
    </span>
  );
}
