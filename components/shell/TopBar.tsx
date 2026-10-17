import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  BookOpen,
  ChevronDown,
  ChevronsUpDown,
  CircleQuestionMark,
  CircleUserRound,
  Inbox,
  Keyboard,
  ListChecks,
  LogOut,
  Menu as MenuIcon,
  Megaphone,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import { useFeature, useSession, useWorkspace, useWorkspaceData } from '../../state';
import { ROLE_LABEL } from '../../shared/permissions';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd, StatusPill } from '../ui/StatusPill';
import { Menu, Popover, type MenuItem } from '../ui/Menu';
import { EmptyState } from '../ui/EmptyState';
import { isMacPlatform } from '../ui/internal/utils';
import { APP_VERSION } from './env';
import { rememberWorkspace, useWsPath } from './workspacePath';

/** "{Org} › {Workspace}" button with a menu of my workspaces (SH-02#AC4). */
export function WorkspaceSwitcher() {
  const { org, workspace, workspaces, switchWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  if (!org || !workspace) return null;
  const items: MenuItem[] = [
    {
      type: 'header',
      id: 'h',
      label: org.name,
      description: `${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}`,
    },
    ...workspaces.map<MenuItem>((w) => ({
      id: w.id,
      label: w.name,
      description: `${ROLE_LABEL[w.role]}${w.implicit && w.role === 'VIEWER' ? ' · view only' : ''}`,
      selected: w.id === workspace.id,
      onSelect: () => {
        if (w.id === workspace.id) return;
        switchWorkspace(w.id);
        rememberWorkspace(org.slug, w.id);
        // Same area/view in the new workspace (SH-01#AC4).
        const next = pathname.replace(/\/w\/[^/]+/, `/w/${encodeURIComponent(w.id)}`);
        navigate(`${next}${search}`);
      },
    })),
  ];
  return (
    <Menu
      placement="bottom-start"
      minWidth={260}
      label="Switch workspace"
      items={items}
      trigger={
        <button
          type="button"
          className="pcp-ws-switcher"
          aria-label={`Workspace: ${org.name}, ${workspace.name}. Switch workspace`}
        >
          <span className="pcp-ws-switcher__org">{org.name}</span>
          <span className="pcp-ws-switcher__sep" aria-hidden="true">
            ›
          </span>
          <span className="pcp-ws-switcher__ws">{workspace.name}</span>
          <Icon icon={ChevronsUpDown} size={16} className="pcp-ws-switcher__icon" />
        </button>
      }
    />
  );
}

/** Search field look-alike that opens the ⌘K dialog (SH-06). */
export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  const mac = isMacPlatform();
  return (
    <>
      <button
        type="button"
        className="pcp-search-trigger"
        onClick={onOpen}
        aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
      >
        <Icon icon={Search} size={16} className="pcp-search-trigger__icon" />
        <span className="pcp-search-trigger__placeholder">Search people, projects, crafts</span>
        <Kbd className="pcp-search-trigger__kbd">{mac ? '⌘K' : 'Ctrl K'}</Kbd>
      </button>
      <IconButton icon={Search} label="Search" className="pcp-search-trigger-icon" onClick={onOpen} />
    </>
  );
}

export function HelpMenu({
  onGlossary,
  onShortcuts,
  onWhatsNew,
  onAssistant,
}: {
  onGlossary: () => void;
  onShortcuts: () => void;
  onWhatsNew: () => void;
  onAssistant: () => void;
}) {
  const ai = useFeature('aiAssistant');
  const items: MenuItem[] = [
    { id: 'glossary', label: 'Glossary', icon: BookOpen, onSelect: onGlossary },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, shortcut: '?', onSelect: onShortcuts },
    { id: 'new', label: `What's new · v${APP_VERSION}`, icon: Megaphone, onSelect: onWhatsNew },
    ...(ai
      ? [
          { type: 'separator' as const, id: 'sep' },
          { id: 'ai', label: 'Ask the assistant', icon: Sparkles, onSelect: onAssistant },
        ]
      : []),
  ];
  return <Menu label="Help" items={items} trigger={<IconButton icon={CircleQuestionMark} label="Help" />} />;
}

/** Bell with count = proposals awaiting my answer + craft changes awaiting my approval (SH-02#AC4). */
export function NotificationsBell() {
  const { workspace, can } = useWorkspace();
  const { snapshot } = useWorkspaceData();
  const to = useWsPath();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const counts = useMemo(() => {
    if (!snapshot) return { proposals: 0, approvals: 0 };
    const mine = workspace?.linkedPersonId ?? null;
    const proposals = mine
      ? snapshot.allocations.filter((a) => a.resourceId === mine && a.state === 'tentative').length
      : 0;
    const approvals = can('craftProfile.approve')
      ? snapshot.craftRequests.filter((r) => r.status === 'pending').length
      : 0;
    return { proposals, approvals };
  }, [snapshot, workspace, can]);
  const total = counts.proposals + counts.approvals;
  const go = (path: string) => {
    setOpen(false);
    navigate(to(path));
  };
  return (
    <Popover
      label="Notifications"
      open={open}
      onOpenChange={setOpen}
      width={340}
      trigger={<IconButton icon={Bell} label="Notifications" badge={total || undefined} noTooltip={open} />}
    >
      <div className="pcp-notify">
        <div className="pcp-notify__header">
          <span className="pcp-notify__title">Notifications</span>
        </div>
        {total === 0 ? (
          <EmptyState
            icon={Inbox}
            title="You're all caught up"
            description="Proposals and approvals for you appear here."
            compact
          />
        ) : (
          <ul className="pcp-notify__list">
            {counts.proposals > 0 ? (
              <li>
                <button type="button" className="pcp-notify__item" onClick={() => go('me')}>
                  <Icon icon={Send} size={16} className="pcp-notify__icon" />
                  <span className="pcp-notify__text">
                    <span className="pcp-notify__strong">
                      {counts.proposals} booking{counts.proposals === 1 ? '' : 's'} proposed to you
                    </span>
                    <span className="pcp-notify__sub">Accept or decline them in My plan.</span>
                  </span>
                </button>
              </li>
            ) : null}
            {counts.approvals > 0 ? (
              <li>
                <button type="button" className="pcp-notify__item" onClick={() => go('org/people?tab=requests')}>
                  <Icon icon={ListChecks} size={16} className="pcp-notify__icon" />
                  <span className="pcp-notify__text">
                    <span className="pcp-notify__strong">
                      {counts.approvals} craft change{counts.approvals === 1 ? '' : 's'} waiting for approval
                    </span>
                    <span className="pcp-notify__sub">Review them on People.</span>
                  </span>
                </button>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </Popover>
  );
}

/** Avatar menu: name and email header, Profile, Sign out (SH-02#AC4). */
export function UserMenu({ onSignOut }: { onSignOut: () => void }) {
  const { me } = useSession();
  const to = useWsPath();
  const { workspace } = useWorkspace();
  if (!me) return null;
  const items: MenuItem[] = [
    { type: 'header', id: 'who', label: me.user.name, description: me.user.email },
    { type: 'separator', id: 's1' },
    ...(workspace ? [{ id: 'profile', label: 'Profile', icon: CircleUserRound, to: to('settings/profile') }] : []),
    { id: 'signout', label: 'Sign out', icon: LogOut, onSelect: onSignOut },
  ];
  return (
    <Menu
      label="Account"
      minWidth={240}
      items={items}
      trigger={
        <button type="button" className="pcp-user-trigger" aria-label={`Account: ${me.user.name}`}>
          <Avatar name={me.user.name} size={28} />
          <Icon icon={ChevronDown} size={16} className="pcp-user-trigger__chevron" />
        </button>
      }
    />
  );
}

export interface TopBarProps {
  onOpenSearch: () => void;
  onOpenNav: () => void;
  onSignOut: () => void;
  onGlossary: () => void;
  onShortcuts: () => void;
  onWhatsNew: () => void;
  onAssistant: () => void;
  /** Mobile page title (below 768 px the top bar shows menu, title and user menu only). */
  mobileTitle?: string;
}

/** White 56 px top bar (DESIGN_SYSTEM §8.1). */
export function TopBar(p: TopBarProps) {
  return (
    <header className="pcp-topbar">
      <div className="pcp-topbar__start">
        <IconButton icon={MenuIcon} label="Open navigation" className="pcp-topbar__menu" onClick={p.onOpenNav} />
        <span className="pcp-topbar__mobile-title">{p.mobileTitle}</span>
        <div className="pcp-topbar__switcher">
          <WorkspaceSwitcher />
        </div>
        <div className="pcp-topbar__search">
          <SearchTrigger onOpen={p.onOpenSearch} />
        </div>
      </div>
      <div className="pcp-topbar__end">
        <span className="pcp-topbar__context">
          <StatusPill tone="neutral" title="You are viewing live data">
            Live
          </StatusPill>
        </span>
        <span className="pcp-topbar__desktop">
          <HelpMenu
            onGlossary={p.onGlossary}
            onShortcuts={p.onShortcuts}
            onWhatsNew={p.onWhatsNew}
            onAssistant={p.onAssistant}
          />
        </span>
        <span className="pcp-topbar__desktop">
          <NotificationsBell />
        </span>
        <UserMenu onSignOut={p.onSignOut} />
      </div>
    </header>
  );
}
