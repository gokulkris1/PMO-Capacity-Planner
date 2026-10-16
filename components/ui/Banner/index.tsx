import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { Icon } from '../Icon';
import { Button } from '../Button';
import { cx } from '../internal/utils';
import './banner.css';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const TONE_ICON: Record<BannerTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  neutral: Info,
};

export interface BannerProps {
  tone?: BannerTone;
  /** Optional bold lead-in. */
  title?: ReactNode;
  children?: ReactNode;
  /** Single action, rendered as a link button. */
  action?: { label: string; onClick: () => void };
  /** Custom action node (e.g. a router LinkButton). */
  actionNode?: ReactNode;
  onDismiss?: () => void;
  icon?: LucideIcon;
  className?: string;
}

/** Page- or card-level message; one page-level banner at a time (DESIGN_SYSTEM §8.14). */
export function Banner({ tone = 'info', title, children, action, actionNode, onDismiss, icon, className }: BannerProps) {
  const live = tone === 'danger' ? 'alert' : 'status';
  return (
    <div className={cx('pcp-banner', `pcp-banner--${tone}`, className)} role={live}>
      <span className="pcp-banner__icon">
        <Icon icon={icon ?? TONE_ICON[tone]} size={16} />
      </span>
      <div className="pcp-banner__content">
        {title ? <strong className="pcp-banner__title">{title}</strong> : null}
        {children ? <span className="pcp-banner__text">{children}</span> : null}
      </div>
      {action || actionNode ? (
        <div className="pcp-banner__action">
          {actionNode ?? (
            <Button variant="link" onClick={action?.onClick}>
              {action?.label}
            </Button>
          )}
        </div>
      ) : null}
      {onDismiss ? (
        <button type="button" className="pcp-banner__dismiss" aria-label="Dismiss" onClick={onDismiss}>
          <Icon icon={X} size={16} />
        </button>
      ) : null}
    </div>
  );
}
