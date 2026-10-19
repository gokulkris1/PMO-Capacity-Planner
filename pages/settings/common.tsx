import type { ReactNode } from 'react';
import {
  BadgeCheck,
  Building2,
  CircleUserRound,
  Layers,
  Network,
  Plug,
  SlidersHorizontal,
  ToggleRight,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '../../shared/permissions';
import { ApiRequestError, useSession, useWorkspace } from '../../state';
import { useDocumentTitle } from '../../components/ui/hooks';
import { APP_MODE } from '../../components/shell/env';
import { cx } from '../../components/ui/internal/utils';
import './settings.css';

export interface SettingsSectionDef {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Visible when the user has any of these (empty = everyone). */
  anyOf: Permission[];
  publicOnly?: boolean;
}

/** Settings sections in order (ST-01#AC1); sections without permission are absent. */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'profile',
    label: 'Profile',
    icon: CircleUserRound,
    description: 'Your name, password, two-step verification and sessions.',
    anyOf: [],
  },
  {
    id: 'organisation',
    label: 'Organisation',
    icon: Building2,
    description: 'Organisation details, workspace visibility and workspaces.',
    anyOf: ['org.manage'],
  },
  {
    id: 'members',
    label: 'Members and roles',
    icon: UserPlus,
    description: 'Invite people and choose what they can do in each workspace.',
    anyOf: ['org.members.manage', 'workspace.members.manage'],
  },
  {
    id: 'structure',
    label: 'Structure',
    icon: Network,
    description: 'Tribes, chapters and teams used to group people and projects.',
    anyOf: ['structure.write', 'people.write'],
  },
  {
    id: 'crafts',
    label: 'Crafts',
    icon: Layers,
    description: 'The craft catalogue people declare above and below the table.',
    anyOf: ['structure.write', 'people.write'],
  },
  {
    id: 'planning',
    label: 'Planning',
    icon: SlidersHorizontal,
    description: 'Fiscal calendar, utilisation bands, targets, sprint length and the Planview rule.',
    anyOf: ['org.manage', 'people.write'],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: Plug,
    description: 'Connections to Jira Cloud and Planview.',
    anyOf: ['integrations.view'],
  },
  {
    id: 'features',
    label: 'Features',
    icon: ToggleRight,
    description: 'Optional modules for your organisation.',
    anyOf: ['org.manage'],
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: BadgeCheck,
    description: 'Plan, limits and usage.',
    anyOf: ['org.billing'],
    publicOnly: true,
  },
];

/** Sections the current user may open. */
export function useVisibleSections(): SettingsSectionDef[] {
  const { can } = useWorkspace();
  const { me } = useSession();
  const appMode = me?.appMode ?? APP_MODE;
  return SETTINGS_SECTIONS.filter(
    (s) => (s.anyOf.length === 0 || s.anyOf.some((p) => can(p))) && (!s.publicOnly || appMode === 'public'),
  );
}

/** Section heading inside the settings content column. */
export function SectionHeader({ id, actions }: { id: string; actions?: ReactNode }) {
  const def = SETTINGS_SECTIONS.find((s) => s.id === id);
  useDocumentTitle(def ? `${def.label} · Settings` : 'Settings');
  if (!def) return null;
  return (
    <div className="pcp-settings__section-head">
      <div className="pcp-settings__section-titles">
        <h2 className="pcp-settings__section-title">{def.label}</h2>
        <p className="pcp-settings__section-desc">{def.description}</p>
      </div>
      {actions ? <div className="pcp-settings__section-actions">{actions}</div> : null}
    </div>
  );
}

/** Content column; `wide` for tables (forms cap at 720 px, DESIGN_SYSTEM §13). */
export function SectionBody({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={cx('pcp-settings__body', wide && 'pcp-settings__body--wide')}>{children}</div>;
}

/** Plain-language error copy with request reference; never raw server text. */
export function errorText(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 403 && e.code === 'forbidden') return "You don't have permission to do that.";
    if (e.status === 403 && e.code === 'entitlement') return e.message || 'Your plan does not include this.';
    if (e.status === 501) return "This isn't available yet.";
    if ((e.status === 400 || e.status === 409) && e.message) return e.message;
    // e.g. "Your current password is incorrect." on Profile › Change password.
    if (e.status === 401 && e.message && e.message !== 'Sign in to continue.') return e.message;
    // QA-009: Jira/Planview unreachable (502) or too slow (504): the API's message says what to do.
    if ((e.status === 502 || e.status === 504) && e.message) return e.message;
    // UAT-01: e.g. INTEGRATIONS_ENC_KEY is not set; the API's message says what is missing and who can fix it.
    if (e.code === 'not_configured' && e.message) return e.message;
    return e.requestId
      ? `Something went wrong. Try again, or quote reference ${e.requestId}.`
      : 'Something went wrong. Try again.';
  }
  return 'Something went wrong. Try again.';
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
