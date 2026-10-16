import type { ElementType, ReactNode } from 'react';
import { useId } from 'react';
import { cx } from '../internal/utils';
import './card.css';

export interface CardProps {
  children: ReactNode;
  /** Card title (H3). */
  title?: ReactNode;
  /** Caption under the title (e.g. time basis "QBR1 · Q4 2026"). */
  subtitle?: ReactNode;
  /** Right-aligned header actions (subtle sm Buttons, a SegmentedControl, a Menu). */
  actions?: ReactNode;
  /** 16 px padding instead of 24. */
  dense?: boolean;
  /** No body padding (tables, lists that run edge to edge). */
  flush?: boolean;
  /** Footer row with a top border (e.g. "View all" link). */
  footer?: ReactNode;
  /** Rendered element; defaults to <section> when titled, else <div>. */
  as?: ElementType;
  className?: string;
  /** Heading level for the title. */
  headingLevel?: 2 | 3 | 4;
}

/** Surface with a 1 px border and 6 px radius; never nested more than one level (DESIGN_SYSTEM §8.20). */
export function Card({
  children,
  title,
  subtitle,
  actions,
  dense,
  flush,
  footer,
  as,
  className,
  headingLevel = 3,
}: CardProps) {
  const headingId = useId();
  const Tag = (as ?? (title ? 'section' : 'div')) as ElementType;
  const Heading = `h${headingLevel}` as ElementType;
  return (
    <Tag
      className={cx('pcp-card', dense && 'pcp-card--dense', flush && 'pcp-card--flush', className)}
      aria-labelledby={title ? headingId : undefined}
    >
      {title || actions ? (
        <header className="pcp-card__header">
          <div className="pcp-card__titles">
            {title ? (
              <Heading id={headingId} className="pcp-card__title">
                {title}
              </Heading>
            ) : null}
            {subtitle ? <p className="pcp-card__subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="pcp-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="pcp-card__body">{children}</div>
      {footer ? <footer className="pcp-card__footer">{footer}</footer> : null}
    </Tag>
  );
}

/** Alias kept for readability in page code ("Panel" in the B2 brief). */
export const Panel = Card;
