import type { ReactNode } from 'react';
import { Funnel, type LucideIcon } from 'lucide-react';
import { Icon } from '../Icon';
import { Button } from '../Button';
import { cx } from '../internal/utils';
import './empty.css';

export interface EmptyStateProps {
  /** Lucide icon, 32 px tertiary (e.g. Users). No emoji, no illustrations. */
  icon?: LucideIcon;
  title: string;
  /** One sentence. */
  description?: ReactNode;
  /** One primary Button. */
  action?: ReactNode;
  /** Optional secondary link button. */
  secondaryAction?: ReactNode;
  /** Smaller padding for use inside cards/tables. */
  compact?: boolean;
  className?: string;
}

/** Centred block: icon, title, one sentence, one primary action (DESIGN_SYSTEM §8.15). */
export function EmptyState({ icon, title, description, action, secondaryAction, compact, className }: EmptyStateProps) {
  return (
    <div className={cx('pcp-empty', compact && 'pcp-empty--compact', className)}>
      {icon ? (
        <span className="pcp-empty__icon">
          <Icon icon={icon} size={32} />
        </span>
      ) : null}
      <p className="pcp-empty__title">{title}</p>
      {description ? <p className="pcp-empty__description">{description}</p> : null}
      {action || secondaryAction ? (
        <div className="pcp-empty__actions">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

/** Filtered-empty variant: Funnel icon and a "Clear filters" action. */
export function FilteredEmptyState({
  thing = 'items',
  onClear,
  clearAction,
}: {
  /** Plural noun, e.g. "people". */
  thing?: string;
  onClear?: () => void;
  /** Custom clear control (defaults to a link button calling onClear). */
  clearAction?: ReactNode;
}) {
  return (
    <EmptyState
      icon={Funnel}
      title={`No ${thing} match these filters.`}
      description="Try removing a filter or searching for something else."
      compact
      action={
        clearAction ??
        (onClear ? (
          <Button variant="link" onClick={onClear}>
            Clear filters
          </Button>
        ) : undefined)
      }
    />
  );
}
