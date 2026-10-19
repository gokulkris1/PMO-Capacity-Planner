import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Compass, SendHorizontal, Sparkles, X } from 'lucide-react';
import { ApiRequestError, useApi, useFeature, useWorkspace, userMessage } from '../../state';
import { Banner } from '../ui/Banner';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { cx } from '../ui/internal/utils';
import { useWsPath } from './workspacePath';
import './ask-tom.css';

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

/** Turns sent back with each question so follow-ups make sense (the server accepts at most 8). */
const HISTORY_TURNS = 8;

const STARTERS = [
  'Who is over capacity in QBR1?',
  'Where is demand not covered next quarter?',
  'How do I propose a booking to someone?',
  'What does "below the table" mean?',
];

/** Plain-text answer with "- " lines shown as a list. */
function Answer({ text }: { text: string }) {
  const blocks: Array<{ list: boolean; lines: string[] }> = [];
  for (const line of text.split('\n')) {
    const item = /^\s*(?:[-*•]|\d+\.)\s+/.test(line);
    const last = blocks[blocks.length - 1];
    if (!line.trim()) {
      blocks.push({ list: false, lines: [] });
    } else if (last && last.list === item && (item || last.lines.length)) {
      last.lines.push(item ? line.replace(/^\s*(?:[-*•]|\d+\.)\s+/, '') : line);
    } else {
      blocks.push({ list: item, lines: [item ? line.replace(/^\s*(?:[-*•]|\d+\.)\s+/, '') : line] });
    }
  }
  return (
    <>
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.list ? (
            <ul key={i}>
              {b.lines.map((l, j) => (
                <li key={j}>{l}</li>
              ))}
            </ul>
          ) : (
            <p key={i}>{b.lines.join('\n')}</p>
          ),
        )}
    </>
  );
}

interface AskTomProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTour: () => void;
  onGlossary: () => void;
}

/**
 * Ask Tom (HS-11): the AI assistant as a floating button and a docked, non-modal chat panel on every page. Tom
 * answers questions about this workspace's plan and about using the tool. The client sends the question, the
 * workspace id and the earlier turns only; the server builds the prompt and enforces the monthly quota.
 */
export function AskTom(props: AskTomProps) {
  const { workspaceId } = useApi();
  // A different workspace means a different plan: remounting starts a fresh conversation.
  return <AskTomPanel key={workspaceId ?? 'none'} {...props} />;
}

function AskTomPanel({ open, onOpenChange, onTour, onGlossary }: AskTomProps) {
  const { api, workspaceId } = useApi();
  const { can } = useWorkspace();
  const enabled = useFeature('aiAssistant');
  const to = useWsPath();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, busy]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || !workspaceId || busy) return;
    setBusy(true);
    setError(null);
    const history = turns.slice(-HISTORY_TURNS).map(({ role, content }) => ({ role, content: content.slice(0, 4000) }));
    setTurns((t) => [...t, { id: Date.now(), role: 'user', content: q }]);
    setQuestion('');
    try {
      const { answer } = await api.ai.ask(workspaceId, q, history);
      setTurns((t) => [...t, { id: Date.now() + 1, role: 'assistant', content: answer }]);
    } catch (err) {
      // Take the unanswered question back out so the conversation stays in user/assistant pairs.
      setTurns((t) => t.slice(0, -1));
      setQuestion(q);
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

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(question);
    }
  };

  return (
    <>
      {!open ? (
        <button type="button" className="pcp-tom-launcher" data-tour="ask-tom" onClick={() => onOpenChange(true)}>
          <Icon icon={Sparkles} size={16} />
          <span>Ask Tom</span>
        </button>
      ) : null}
      {open ? (
        <section
          className="pcp-tom"
          role="dialog"
          aria-modal="false"
          aria-labelledby="pcp-tom-title"
        >
          <header className="pcp-tom__header">
            <span className="pcp-tom__avatar" aria-hidden="true">
              T
            </span>
            <div className="pcp-tom__heading">
              <h2 id="pcp-tom-title">Ask Tom</h2>
              <p>Your plan and how to use this tool</p>
            </div>
            <IconButton icon={X} label="Close Ask Tom" onClick={() => onOpenChange(false)} />
          </header>

          {!enabled ? (
            <div className="pcp-tom__body pcp-tom__off">
              <p>
                <strong>Ask Tom is switched off for your organisation.</strong>{' '}
                {can('org.manage')
                  ? 'You can switch it on in Settings › Features.'
                  : 'An Org Admin can switch it on in Settings › Features.'}
              </p>
              <p className="pcp-text-secondary">Until then, the tour and the glossary explain every page and term.</p>
              <div className="pcp-tom__actions">
                <Button iconBefore={Compass} onClick={onTour}>
                  Take the tour
                </Button>
                <Button iconBefore={BookOpen} onClick={onGlossary}>
                  Glossary
                </Button>
                {can('org.manage') ? (
                  <Button variant="link" onClick={() => navigate(to('settings/features'))}>
                    Open Settings › Features
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div className="pcp-tom__body" ref={logRef} aria-live="polite">
                {turns.length === 0 ? (
                  <div className="pcp-tom__welcome">
                    <p>
                      Hi, I&apos;m Tom. Ask me about this workspace&apos;s capacity, or how to do something in the
                      tool.
                    </p>
                    <ul className="pcp-tom__starters" aria-label="Suggested questions">
                      {STARTERS.map((s) => (
                        <li key={s}>
                          <button type="button" className="pcp-tom__starter" onClick={() => void ask(s)}>
                            {s}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="pcp-tom__tour-link" onClick={onTour}>
                      <Icon icon={Compass} size={16} /> New here? Take the tour
                    </button>
                  </div>
                ) : (
                  <ol className="pcp-tom__log" aria-label="Conversation">
                    {turns.map((t) => (
                      <li key={t.id} className={cx('pcp-tom__msg', `pcp-tom__msg--${t.role}`)}>
                        <span className="pcp-sr-only">{t.role === 'user' ? 'You:' : 'Tom:'}</span>
                        {t.role === 'assistant' ? <Answer text={t.content} /> : <p>{t.content}</p>}
                      </li>
                    ))}
                    {busy ? (
                      <li className="pcp-tom__msg pcp-tom__msg--assistant pcp-tom__thinking">
                        <Spinner /> Tom is thinking…
                      </li>
                    ) : null}
                  </ol>
                )}
              </div>
              {error ? (
                <div className="pcp-tom__error">
                  <Banner tone="danger">{error}</Banner>
                </div>
              ) : null}
              <form className="pcp-tom__composer" onSubmit={onSubmit}>
                <label htmlFor="pcp-tom-input" className="pcp-sr-only">
                  Your question
                </label>
                <textarea
                  id="pcp-tom-input"
                  ref={inputRef}
                  rows={2}
                  maxLength={2000}
                  placeholder="Ask Tom…"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={busy}
                />
                <IconButton
                  type="submit"
                  icon={SendHorizontal}
                  label="Send"
                  variant="primary"
                  disabled={busy || !question.trim()}
                />
              </form>
              <p className="pcp-tom__note">
                Tom uses this workspace&apos;s plan and can be wrong. Check important figures in the plan.
                {turns.length ? (
                  <>
                    {' '}
                    <button type="button" className="pcp-tom__clear" onClick={() => setTurns([])}>
                      New conversation
                    </button>
                  </>
                ) : null}
              </p>
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
