import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Ellipsis } from 'lucide-react';
import { Icon } from '../Icon';
import { IconButton } from '../Button';
import { Menu, type MenuItem } from '../Menu';
import { Tooltip } from '../Tooltip';
import { useDocumentTitle } from '../hooks';
import { cx } from '../internal/utils';
import './page-header.css';

export interface Crumb {
  label: string;
  /** Router path; the last crumb is never a link. */
  to?: string;
}

/** Breadcrumb trail (caption, ChevronRight separators, last crumb not a link). */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={cx('pcp-breadcrumbs', className)}>
      <ol className="pcp-breadcrumbs__list">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="pcp-breadcrumbs__item">
              {c.to && !last ? (
                <Link to={c.to} className="pcp-breadcrumbs__link">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined}>{c.label}</span>
              )}
              {!last ? <Icon icon={ChevronRight} size={12} className="pcp-breadcrumbs__sep" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps {
  title: string;
  breadcrumbs?: Crumb[];
  /** One line; truncates with an ellipsis and the full text is in a tooltip. */
  description?: string;
  /** Right-aligned actions: at most one primary Button, then secondary Buttons (never wrap). */
  actions?: ReactNode;
  /** Overflow menu items (Export/Import and rarely used actions) behind an "More actions" IconButton. */
  overflow?: MenuItem[];
  /** Right side of the description row, e.g. <TimeBasisControl /> from components/shell. */
  timeBasis?: ReactNode;
  /** Page tabs row (underline Tabs). */
  tabs?: ReactNode;
  /** Set false when the page sets document.title itself. */
  setTitle?: boolean;
  /** Override for document.title (defaults to title). */
  documentTitle?: string;
  className?: string;
}

/**
 * Breadcrumbs, H1, actions, one-line description, time basis and tabs (DESIGN_SYSTEM §8.2, SH-03).
 * Also sets document.title to "{title} · PMO Capacity Planner".
 */
export function PageHeader({
  title,
  breadcrumbs,
  description,
  actions,
  overflow,
  timeBasis,
  tabs,
  setTitle = true,
  documentTitle,
  className,
}: PageHeaderProps) {
  useDocumentTitle(setTitle ? (documentTitle ?? title) : undefined);
  return (
    <header className={cx('pcp-page-header', tabs ? 'pcp-page-header--tabs' : undefined, className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="pcp-page-header__row">
        <h1 className="pcp-page-header__title">{title}</h1>
        {actions || (overflow && overflow.length > 0) ? (
          <div className="pcp-page-header__actions">
            {actions}
            {overflow && overflow.length > 0 ? (
              <Menu
                trigger={<IconButton icon={Ellipsis} label="More actions" variant="secondary" />}
                items={overflow}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {description || timeBasis ? (
        <div className="pcp-page-header__meta">
          {description ? (
            <Tooltip content={description} block placement="bottom">
              <p className="pcp-page-header__description" tabIndex={-1}>
                {description}
              </p>
            </Tooltip>
          ) : (
            <span />
          )}
          {timeBasis ? <div className="pcp-page-header__basis">{timeBasis}</div> : null}
        </div>
      ) : null}
      {tabs ? <div className="pcp-page-header__tabs">{tabs}</div> : null}
    </header>
  );
}
