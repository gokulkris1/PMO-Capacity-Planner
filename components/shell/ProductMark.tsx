import { cx } from '../ui/internal/utils';
import './product-mark.css';

/** The PMO Capacity Planner mark: primary rounded square with three capacity bars (DESIGN_SYSTEM §9). */
export function ProductMark({ size = 24, className }: { size?: 24 | 32 | 40; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cx('pcp-mark', className)}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="24" height="24" rx="6" className="pcp-mark__bg" />
      <rect x="5" y="6.5" width="8" height="2.5" rx="1.25" className="pcp-mark__bar" />
      <rect x="5" y="10.75" width="11" height="2.5" rx="1.25" className="pcp-mark__bar" />
      <rect x="5" y="15" width="14" height="2.5" rx="1.25" className="pcp-mark__bar" />
    </svg>
  );
}

/** Mark + "PMO Capacity Planner" wordmark; `tone="inverse"` on navy. */
export function Wordmark({
  size = 'sm',
  tone = 'default',
  className,
}: {
  size?: 'sm' | 'lg';
  tone?: 'default' | 'inverse';
  className?: string;
}) {
  return (
    <span className={cx('pcp-wordmark', `pcp-wordmark--${size}`, `pcp-wordmark--${tone}`, className)}>
      <ProductMark size={size === 'lg' ? 32 : 24} />
      <span className="pcp-wordmark__text">PMO Capacity Planner</span>
    </span>
  );
}
