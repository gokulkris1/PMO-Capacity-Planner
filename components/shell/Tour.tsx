import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_GUIDE, SHELL_GUIDE, type GuideEntry } from '../../shared/help/guide';
import { Button } from '../ui/Button';
import { useFocusTrap } from '../ui/internal/utils';
import type { NavItem } from './nav';
import './tour.css';

interface TourStep {
  id: string;
  title: string;
  summary: string;
  howTo: string[];
  /** `data-tour` value of the element to point at; the card is centred when it is missing (mobile, rail). */
  target?: string;
}

/** Version the "seen" flag so a big release can show the tour again. */
export const TOUR_VERSION = 'v2';

const PAD = 6;
const GAP = 14;
const CARD_W = 360;

function guide(list: GuideEntry[], id: string): GuideEntry | undefined {
  return list.find((g) => g.id === id);
}

/** Welcome, every page this user can see (role-aware: built from their navigation), the shell, then a wrap-up. */
export function buildTourSteps(navItems: NavItem[], userName: string | null): TourStep[] {
  const first = userName?.split(' ')[0];
  const steps: TourStep[] = [
    {
      id: 'welcome',
      title: first ? `Welcome, ${first}` : 'Welcome to PMO Capacity Planner',
      summary:
        'This tool shows who in the PMO squad is working on what, quarter by quarter, and where demand is not covered. This tour takes about two minutes and shows what every part of the navigation is for.',
      howTo: ['Use the arrow keys or the buttons to move through it; Escape closes it.'],
    },
  ];
  for (const item of navItems) {
    const g = guide(PAGE_GUIDE, item.id);
    if (g) steps.push({ id: item.id, title: item.label, summary: g.summary, howTo: g.howTo, target: `nav-${item.id}` });
  }
  for (const id of ['search', 'notifications', 'help', 'ask-tom']) {
    const g = guide(SHELL_GUIDE, id);
    if (g) steps.push({ id, title: g.title, summary: g.summary, howTo: g.howTo, target: id });
  }
  steps.push({
    id: 'done',
    title: "You're ready",
    summary:
      'Start on Home to see what needs attention. You can take this tour again any time from Help (the ? in the top bar), and Ask Tom can answer questions about any page.',
    howTo: [],
  });
  return steps;
}

function targetRect(target: string | undefined): DOMRect | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

/** Card position: right of the target (sidebar), else below or above it, clamped to the viewport. */
function cardPosition(rect: DOMRect | null, cardH: number): { left: number; top: number } | null {
  if (!rect) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 32);
  let left: number;
  let top: number;
  if (rect.right + GAP + w <= vw - 16) {
    left = rect.right + GAP;
    top = rect.top + rect.height / 2 - cardH / 2;
  } else if (rect.bottom + GAP + cardH <= vh - 16) {
    left = rect.left + rect.width / 2 - w / 2;
    top = rect.bottom + GAP;
  } else {
    left = rect.left + rect.width / 2 - w / 2;
    top = rect.top - GAP - cardH;
  }
  return {
    left: Math.max(16, Math.min(left, vw - w - 16)),
    top: Math.max(16, Math.min(top, vh - cardH - 16)),
  };
}

/**
 * The guided tour: a spotlight on each navigation item and shell control with a card explaining it. Shown once per
 * user automatically and again whenever they choose "Take the tour" (Help menu or Ask Tom).
 */
export function Tour({ open, steps, onClose }: { open: boolean; steps: TourStep[]; onClose: () => void }) {
  // Mounted only while open, so every tour starts at the first step.
  return open && steps.length ? <TourCard steps={steps} onClose={onClose} /> : null;
}

function TourCard({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardH, setCardH] = useState(240);
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef, true);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;

  const measure = useCallback(() => setRect(targetRect(step.target)), [step]);

  // Point at the step's element once it is scrolled into view, and follow it on resize and scroll.
  useEffect(() => {
    const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    el?.scrollIntoView({ block: 'nearest' });
    const frame = requestAnimationFrame(measure);
    cardRef.current?.focus();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step, measure]);

  // The card's height changes with each step's text; re-place it when it does.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const ro = new ResizeObserver(() => setCardH(card.offsetHeight));
    ro.observe(card);
    return () => ro.disconnect();
  }, []);

  const next = useCallback(() => (last ? onClose() : setIndex((i) => i + 1)), [last, onClose]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [next, back, onClose]);

  const pos = useMemo(() => cardPosition(rect, cardH), [rect, cardH]);
  return (
    <div className="pcp-tour">
      {rect ? (
        <div
          className="pcp-tour__spotlight"
          aria-hidden="true"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + 2 * PAD,
            height: rect.height + 2 * PAD,
          }}
        />
      ) : (
        <div className="pcp-tour__scrim" aria-hidden="true" />
      )}
      <div
        ref={cardRef}
        className={pos ? 'pcp-tour__card' : 'pcp-tour__card pcp-tour__card--centred'}
        style={pos ?? undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pcp-tour-title"
        aria-describedby="pcp-tour-summary"
        tabIndex={-1}
      >
        <p className="pcp-tour__progress">
          {index + 1} of {steps.length}
        </p>
        <h2 id="pcp-tour-title" className="pcp-tour__title">
          {step.title}
        </h2>
        <p id="pcp-tour-summary" className="pcp-tour__summary">
          {step.summary}
        </p>
        {step.howTo.length ? (
          <ul className="pcp-tour__howto">
            {step.howTo.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        ) : null}
        <div className="pcp-tour__footer">
          {!last ? (
            <Button variant="link" onClick={onClose}>
              Skip tour
            </Button>
          ) : (
            <span />
          )}
          <div className="pcp-tour__nav">
            {index > 0 ? <Button onClick={back}>Back</Button> : null}
            <Button variant="primary" onClick={next}>
              {last ? 'Finish' : index === 0 ? 'Start the tour' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
