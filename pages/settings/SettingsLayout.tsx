import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon, PageHeader, Skeleton } from '../../components/ui';
import { useWsPath } from '../../components/shell/workspacePath';
import { cx } from '../../components/ui/internal/utils';
import { useVisibleSections } from './common';
import './settings.css';

/** Settings shell (ST-01): page header "Settings", left sub-navigation, section content. */
export default function SettingsLayout() {
  const sections = useVisibleSections();
  const to = useWsPath();
  const { pathname } = useLocation();
  const current = sections.find((s) => pathname.endsWith(`/settings/${s.id}`));
  return (
    <>
      <PageHeader
        title="Settings"
        setTitle={false}
        breadcrumbs={current ? [{ label: 'Settings', to: to('settings') }, { label: current.label }] : undefined}
      />
      <div className="pcp-page pcp-settings">
        <nav className="pcp-settings__nav" aria-label="Settings sections">
          <ul className="pcp-settings__nav-list">
            {sections.map((s) => (
              <li key={s.id}>
                <NavLink
                  to={to(`settings/${s.id}`)}
                  className={({ isActive }) =>
                    cx('pcp-settings__nav-item', isActive && 'pcp-settings__nav-item--active')
                  }
                >
                  <Icon icon={s.icon} size={16} />
                  <span>{s.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="pcp-settings__content">
          <Suspense fallback={<Skeleton variant="text" lines={6} label="settings" />}>
            <Outlet />
          </Suspense>
        </div>
      </div>
    </>
  );
}
