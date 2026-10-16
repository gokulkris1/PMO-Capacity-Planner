import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuarters, type QuarterView, type TimeBasis } from '../../state';
import { SegmentedControl } from '../ui/Tabs';
import { formatDate } from '../ui/hooks';

export const BASIS_KEYS = ['today', 'qbr1', 'qbr2', 'qbr3', 'qbr4', 'window'] as const;
export type BasisKey = (typeof BASIS_KEYS)[number];

export interface TimeBasisState {
  key: BasisKey;
  /** The TimeBasis for view-models (state/ contract). */
  basis: TimeBasis;
  /** The selected quarter for qbr1–qbr4, else null. */
  quarter: QuarterView | null;
  quarters: QuarterView[];
  /** Caption every KPI repeats, e.g. "QBR1 · Q4 2026" (SH-03#AC2). */
  caption: string;
  setKey: (key: BasisKey) => void;
}

/** Time basis from `?basis=` (today | qbr1…qbr4 | window), mapped to TimeBasis (SH-03). */
export function useTimeBasis(defaultKey: BasisKey = 'qbr1'): TimeBasisState {
  const quarters = useQuarters();
  const [params, setParams] = useSearchParams();
  const raw = params.get('basis');
  const key: BasisKey = (BASIS_KEYS as readonly string[]).includes(raw ?? '') ? (raw as BasisKey) : defaultKey;
  const setKey = useCallback(
    (k: BasisKey) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('basis', k);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return useMemo(() => {
    let basis: TimeBasis;
    let quarter: QuarterView | null = null;
    let caption: string;
    if (key === 'today') {
      basis = { kind: 'today' };
      caption = `Today · ${formatDate(new Date().toISOString())}`;
    } else if (key === 'window') {
      basis = { kind: 'window' };
      const first = quarters[0];
      const last = quarters[quarters.length - 1];
      caption = first && last ? `QBR1–QBR4 · ${first.calendarLabel} – ${last.calendarLabel}` : 'QBR1–QBR4';
    } else {
      const idx = Number(key.slice(3)) - 1;
      quarter = quarters[idx] ?? null;
      basis = quarter ? { kind: 'quarter', key: quarter.key } : { kind: 'today' };
      caption = quarter ? `${quarter.label} · ${quarter.calendarLabel}` : key.toUpperCase();
    }
    return { key, basis, quarter, quarters, caption, setKey };
  }, [key, quarters, setKey]);
}

/**
 * "Today · QBR1 · QBR2 · QBR3 · QBR4 · Window" (sm SegmentedControl) bound to `?basis=`; each quarter's
 * calendar and fiscal label is in its tooltip (SH-03#AC2). Put it in PageHeader's `timeBasis` slot.
 */
export function TimeBasisControl({ state }: { state: TimeBasisState }) {
  const { quarters } = state;
  const options = BASIS_KEYS.map((k) => {
    if (k === 'today') return { value: k, label: 'Today', title: 'Today' };
    if (k === 'window') {
      const first = quarters[0];
      const last = quarters[quarters.length - 1];
      return {
        value: k,
        label: 'Window',
        title: first && last ? `QBR1–QBR4 = ${first.calendarLabel} – ${last.calendarLabel}` : 'QBR1–QBR4',
      };
    }
    const q = quarters[Number(k.slice(3)) - 1];
    return {
      value: k,
      label: k.toUpperCase(),
      title: q
        ? `${q.label} = ${q.calendarLabel}${q.fiscalLabel !== q.calendarLabel ? ` (${q.fiscalLabel})` : ''}`
        : undefined,
    };
  });
  return (
    <SegmentedControl<BasisKey>
      label="Time basis"
      size="sm"
      value={state.key}
      onChange={state.setKey}
      options={options}
    />
  );
}
