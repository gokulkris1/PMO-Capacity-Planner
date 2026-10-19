import { GLOSSARY } from '../../shared/help/guide';
import { Dialog } from '../ui/Dialog';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/StatusPill';
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
