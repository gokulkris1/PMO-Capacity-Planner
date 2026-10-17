import { useState, type FormEvent } from 'react';
import { Sparkles } from 'lucide-react';
import { ApiRequestError, useApi, useFeature, userMessage } from '../../state';
import { Banner } from '../ui/Banner';
import { FormField } from '../ui/FormField';
import { Textarea } from '../ui/TextField';
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

/** The optional AI assistant (HS-11): shown only when the org enabled `aiAssistant`. The client sends the question
 *  and the workspace id only; the server builds the prompt from workspace data and enforces the monthly quota. */
export function AssistantDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, workspaceId } = useApi();
  const enabled = useFeature('aiAssistant');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ id: number; question: string; answer: string }>>([]);

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || !workspaceId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { answer } = await api.ai.ask(workspaceId, q);
      setHistory((h) => [{ id: Date.now(), question: q, answer }, ...h].slice(0, 10));
      setQuestion('');
    } catch (err) {
      // QA-029: "not set up" (503) and limits (4xx) are written for people; anything else stays generic.
      setError(
        err instanceof ApiRequestError && err.status === 503 && err.code === 'server_error' && err.message
          ? err.message
          : userMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title="Assistant" subtitle="Answers use this workspace's data">
      {!enabled ? (
        <EmptyState
          icon={Sparkles}
          title="The assistant is turned off"
          description="An Org Admin can switch it on in Settings › Features."
        />
      ) : (
        <div className="pcp-stack">
          <form className="pcp-stack" onSubmit={(e) => void ask(e)}>
            <FormField label="Your question" help="For example: Who is over capacity in QBR1?">
              <Textarea
                rows={3}
                maxLength={2000}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={busy}
              />
            </FormField>
            <div>
              <Button type="submit" variant="primary" iconBefore={Sparkles} loading={busy} disabled={!question.trim()}>
                Ask
              </Button>
            </div>
          </form>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {history.length === 0 ? (
            <p className="pcp-text-secondary">
              Answers are generated from this workspace&apos;s plan and can be wrong. Check important figures in the
              plan itself.
            </p>
          ) : (
            <ol className="pcp-assistant__history" aria-label="Answers">
              {history.map((h) => (
                <li key={h.id} className="pcp-assistant__item">
                  <p className="pcp-assistant__question">{h.question}</p>
                  <p className="pcp-assistant__answer">{h.answer}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Drawer>
  );
}
