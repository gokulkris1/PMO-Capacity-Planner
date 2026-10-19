import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../../state';
import { Skeleton } from '../ui/Skeleton';
import { Tabs } from '../ui/Tabs';
import { useMediaQuery } from '../ui/hooks';
import { cx, readUiPref, useFocusTrap, useScrollLock, writeUiPref } from '../ui/internal/utils';
import { DemoBanner } from '../../pages/system/DemoBanner';
import { ErrorBoundary } from './ErrorBoundary';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { SearchDialog } from './SearchDialog';
import { GlossaryDrawer, ShortcutsDialog, WhatsNewDialog } from './HelpDialogs';
import { AskTom } from './AskTom';
import { TOUR_VERSION, Tour, buildTourSteps } from './Tour';
import { AREA_LABEL, SETTINGS_ITEM, areaViews, useNavGroups } from './nav';
import { useEmbedded } from './embedded';
import { useWorkspaceBase } from './workspacePath';
import './shell.css';

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/** Mobile overlay navigation (below 768 px): left drawer, scrim, focus trap. */
function MobileNav({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  useScrollLock(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="pcp-mobile-nav">
      <div className="pcp-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        className="pcp-mobile-nav__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The app frame (SH-02): navy collapsible sidebar, white top bar, page area with error boundary and
 * lazy-route Suspense; embedded mode (`?embedded=1`) renders the page only, with area tabs.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { me, logout } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const base = useWorkspaceBase() ?? '';
  const groups = useNavGroups();
  const embedded = useEmbedded();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isNarrow = useMediaQuery('(max-width: 1279px)');
  const userId = me?.user.id ?? 'anon';
  const prefKey = `sidebarCollapsed.${userId}`;
  const [storedCollapsed, setStoredCollapsed] = useState<boolean | null>(() =>
    readUiPref<boolean | null>(prefKey, null),
  );
  // Below 1280 px the sidebar starts collapsed unless the user chose otherwise (SH-09#AC1).
  const collapsed = storedCollapsed ?? isNarrow;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dialog, setDialog] = useState<null | 'shortcuts' | 'whatsnew' | 'glossary'>(null);
  const [tomOpen, setTomOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const tourKey = `tourSeen.${TOUR_VERSION}.${userId}`;
  const tourSteps = useMemo(
    () => buildTourSteps([...groups.flatMap((g) => g.items), SETTINGS_ITEM], me?.user.name ?? null),
    [groups, me?.user.name],
  );
  const startTour = useCallback(() => {
    setTomOpen(false);
    setDialog(null);
    setTourOpen(true);
  }, []);
  const endTour = useCallback(() => {
    setTourOpen(false);
    writeUiPref(tourKey, true);
  }, [tourKey]);

  // First visit after sign-in: show the tour once per user (and again after a TOUR_VERSION bump). Automated
  // browsers (e2e) skip it so the overlay does not block their clicks; they can still open it from Help.
  useEffect(() => {
    if (embedded || !me || navigator.webdriver || readUiPref<boolean>(tourKey, false)) return;
    const t = window.setTimeout(() => setTourOpen(true), 600);
    return () => window.clearTimeout(t);
  }, [embedded, me, tourKey]);

  const toggleSidebar = () => {
    const next = !collapsed;
    setStoredCollapsed(next);
    writeUiPref(prefKey, next);
  };

  // Global shortcuts: ⌘K / Ctrl K search; "?" shortcuts (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === '?' && !e.metaKey && !e.ctrlKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setDialog('shortcuts');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Toast stack offset follows the sidebar width (DESIGN_SYSTEM §8.13).
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.sidebar = embedded || isMobile ? 'none' : collapsed ? 'rail' : 'expanded';
    return () => {
      delete html.dataset.sidebar;
    };
  }, [embedded, isMobile, collapsed]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const sub = location.pathname.startsWith(base) ? location.pathname.slice(base.length + 1) : '';
  const area = sub.split('/')[0] ?? '';
  const currentItem =
    [...groups.flatMap((g) => g.items), SETTINGS_ITEM].find((i) => sub === i.path || sub.startsWith(`${i.path}/`)) ??
    null;

  const page = (
    <ErrorBoundary key={location.pathname}>
      <Suspense fallback={<Skeleton variant="page" label="page" />}>{children}</Suspense>
    </ErrorBoundary>
  );

  if (embedded) {
    const views = areaViews(area, groups);
    return (
      <div className="pcp-embedded">
        <a href="#main" className="pcp-skip-link">
          Skip to content
        </a>
        {views.length > 1 ? (
          <div className="pcp-embedded__tabs">
            <Tabs
              label={AREA_LABEL[area] ?? 'Views'}
              value={currentItem?.id ?? ''}
              onChange={(id) => {
                const v = views.find((x) => x.id === id);
                if (v) navigate(`${base}/${v.path}${location.search}`);
              }}
              tabs={views.map((v) => ({ id: v.id, label: v.label }))}
            />
          </div>
        ) : null}
        <main id="main" tabIndex={-1} className="pcp-main pcp-main--embedded">
          {page}
        </main>
      </div>
    );
  }

  return (
    <div className={cx('pcp-shell', collapsed && !isMobile && 'pcp-shell--rail', isMobile && 'pcp-shell--mobile')}>
      <a href="#main" className="pcp-skip-link">
        Skip to content
      </a>
      {!isMobile ? (
        <aside className="pcp-shell__sidebar">
          <Sidebar groups={groups} collapsed={collapsed} onToggle={toggleSidebar} homePath={`${base}/home`} />
        </aside>
      ) : null}
      <MobileNav open={isMobile && mobileOpen} onClose={closeMobile}>
        <Sidebar groups={groups} collapsed={false} overlay onNavigate={closeMobile} homePath={`${base}/home`} />
      </MobileNav>
      <div className="pcp-shell__topbar">
        <TopBar
          onOpenSearch={() => setSearchOpen(true)}
          onOpenNav={() => setMobileOpen(true)}
          onSignOut={() => void signOut()}
          onGlossary={() => setDialog('glossary')}
          onShortcuts={() => setDialog('shortcuts')}
          onWhatsNew={() => setDialog('whatsnew')}
          onAssistant={() => setTomOpen(true)}
          onTour={startTour}
          mobileTitle={currentItem?.label}
        />
      </div>
      <main id="main" tabIndex={-1} className="pcp-main">
        <DemoBanner />
        {page}
      </main>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ShortcutsDialog open={dialog === 'shortcuts'} onClose={() => setDialog(null)} />
      <WhatsNewDialog open={dialog === 'whatsnew'} onClose={() => setDialog(null)} />
      <GlossaryDrawer open={dialog === 'glossary'} onClose={() => setDialog(null)} />
      <AskTom
        open={tomOpen}
        onOpenChange={setTomOpen}
        onTour={startTour}
        onGlossary={() => {
          setTomOpen(false);
          setDialog('glossary');
        }}
      />
      <Tour open={tourOpen} steps={tourSteps} onClose={endTour} />
    </div>
  );
}
