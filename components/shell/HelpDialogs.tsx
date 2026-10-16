import { Sparkles } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/StatusPill';
import { EmptyState } from '../ui/EmptyState';
import { isMacPlatform } from '../ui/internal/utils';
import { APP_VERSION } from './env';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mod = isMacPlatform() ? '⌘' : 'Ctrl';
  const rows: Array<[string, string[]]> = [
    ['Search people, projects, tribes and crafts', [mod, 'K']],
    ['Show keyboard shortcuts', ['?']],
    ['Undo the last change', [mod, 'Z']],
    ['Move between cells in the allocation grid', ['←', '↑', '→', '↓']],
    ['Edit the focused cell', ['Enter']],
    ['Cancel editing or close a dialog', ['Esc']],
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <table className="pcp-shortcuts">
        <caption className="pcp-sr-only">Keyboard shortcuts</caption>
        <tbody>
          {rows.map(([label, keys]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pcp-shortcuts__note">Shortcuts are paused while you type in a field.</p>
    </Dialog>
  );
}

export function WhatsNewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`What's new in ${APP_VERSION}`}
      subtitle="Release 2.0 · Corporate"
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <ul className="pcp-whatsnew">
        <li>
          <strong>A cleaner workspace.</strong> One navigation, every view has its own link, and numbers always state
          their time basis.
        </li>
        <li>
          <strong>Quarter-first planning.</strong> Allocations, demand and capacity are planned across QBR1 to QBR4.
        </li>
        <li>
          <strong>Crafts and structure as data.</strong> Tribes, chapters, teams and the craft catalogue are managed in
          Settings.
        </li>
        <li>
          <strong>Safer access.</strong> Invitations, workspace roles and an audit trail for every change.
        </li>
      </ul>
    </Dialog>
  );
}

const GLOSSARY: Array<[string, string]> = [
  ['Above the table', "A person's primary craft: the work they are hired and measured for. One per person."],
  [
    'Below the table',
    'Additional crafts a person can contribute, each with a proficiency level and a maximum share of time.',
  ],
  ['Craft', 'A PMO discipline such as Programme management or Risk and governance, with a short code (e.g. PM).'],
  [
    'Proficiency L1–L3',
    'L1 contributes with support, L2 contributes independently, L3 can own the craft independently.',
  ],
  ['FTE', 'Full-time equivalent. 1.0 FTE is one person at 100% of their capacity for the period.'],
  ['QBR1–QBR4', 'The four rolling quarters, starting with the current calendar quarter (QBR1).'],
  [
    'Utilisation bands',
    'Available below 50%, Under target 50–89%, On target 90–105%, Over capacity above 105% of target.',
  ],
  ['Calibration', 'Story points per sprint that one FTE delivers in a tribe; turns Jira points into implied FTE.'],
  ['Delivery signal', 'Planned FTE compared with the FTE implied by Jira story points for the same period.'],
  [
    'Tentative / Confirmed',
    'A tentative booking is proposed and waits for the person to accept; confirmed bookings count as load.',
  ],
];

export function GlossaryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title="Glossary" subtitle="Terms used across PMO Capacity Planner">
      <dl className="pcp-glossary">
        {GLOSSARY.map(([term, def]) => (
          <div key={term} className="pcp-glossary__entry">
            <dt>{term}</dt>
            <dd>{def}</dd>
          </div>
        ))}
      </dl>
    </Drawer>
  );
}

/** Placeholder drawer for the optional AI assistant (HS-11; shown only when the org enabled it). */
export function AssistantDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title="Assistant" subtitle="Answers use this workspace's data">
      <EmptyState
        icon={Sparkles}
        title="The assistant is being connected"
        description="Your organisation has enabled the assistant. Questions will be available here once the service is configured."
      />
    </Drawer>
  );
}
