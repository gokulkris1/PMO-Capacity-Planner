import { useId } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { cx } from '../ui/internal/utils';
import { ProductMark } from './ProductMark';
import { SETTINGS_ITEM, type NavGroup, type NavItem } from './nav';
import { useWsPath } from './workspacePath';

export interface SidebarProps {
  groups: NavGroup[];
  collapsed: boolean;
  onToggle?: () => void;
  /** Overlay mode (below 768 px): full labels, no collapse toggle. */
  overlay?: boolean;
  onNavigate?: () => void;
  homePath: string;
}

function NavEntry({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const to = useWsPath();
  const { pathname } = useLocation();
  const href = to(item.path);
  // Active when the path is the item or below it (settings/*, org/tribes/:id, …).
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const link = (
    <NavLink
      to={href}
      className={cx('pcp-nav__item', active && 'pcp-nav__item--active')}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      onClick={onNavigate}
    >
      <Icon icon={item.icon} size={16} className="pcp-nav__icon" />
      <span className="pcp-nav__label">{item.label}</span>
    </NavLink>
  );
  return (
    <li className="pcp-nav__li">
      {collapsed ? (
        <Tooltip content={item.label} placement="right" relation="label">
          {link}
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}

function Group({ group, collapsed, onNavigate }: { group: NavGroup; collapsed: boolean; onNavigate?: () => void }) {
  const headingId = useId();
  return (
    <div className="pcp-nav__group">
      {group.label ? (
        <h2 id={headingId} className={cx('pcp-nav__heading', collapsed && 'pcp-sr-only')}>
          {group.label}
        </h2>
      ) : null}
      <ul className="pcp-nav__list" aria-labelledby={group.label ? headingId : undefined}>
        {group.items.map((item) => (
          <NavEntry key={item.id} item={item} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </ul>
    </div>
  );
}

/** Navy sidebar: brand, grouped nav, pinned Settings and the collapse toggle (DESIGN_SYSTEM §8.1). */
export function Sidebar({ groups, collapsed, onToggle, overlay, onNavigate, homePath }: SidebarProps) {
  const rail = collapsed && !overlay;
  return (
    <div className={cx('pcp-sidebar', rail && 'pcp-sidebar--rail', overlay && 'pcp-sidebar--overlay')}>
      <div className="pcp-sidebar__brand">
        {rail ? (
          <Tooltip content="PMO Capacity Planner" placement="right" relation="label">
            <NavLink to={homePath} className="pcp-sidebar__brand-link" aria-label="PMO Capacity Planner, Home">
              <ProductMark size={24} />
            </NavLink>
          </Tooltip>
        ) : (
          <NavLink
            to={homePath}
            className="pcp-sidebar__brand-link"
            aria-label="PMO Capacity Planner, Home"
            onClick={onNavigate}
          >
            <ProductMark size={24} />
            <span className="pcp-sidebar__wordmark">PMO Capacity Planner</span>
          </NavLink>
        )}
      </div>
      <nav aria-label="Primary" className="pcp-nav">
        <div className="pcp-nav__scroll">
          {groups.map((g) => (
            <Group key={g.id} group={g} collapsed={rail} onNavigate={onNavigate} />
          ))}
        </div>
        <div className="pcp-nav__bottom">
          <ul className="pcp-nav__list" aria-label="Settings">
            <NavEntry item={SETTINGS_ITEM} collapsed={rail} onNavigate={onNavigate} />
          </ul>
          {!overlay && onToggle ? (
            <Tooltip
              content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              placement="right"
              relation="label"
              disabled={!collapsed}
            >
              <button
                type="button"
                className="pcp-nav__item pcp-nav__toggle"
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!collapsed}
                onClick={onToggle}
              >
                <Icon icon={collapsed ? PanelLeftOpen : PanelLeftClose} size={16} className="pcp-nav__icon" />
                <span className="pcp-nav__label">Collapse</span>
              </button>
            </Tooltip>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
