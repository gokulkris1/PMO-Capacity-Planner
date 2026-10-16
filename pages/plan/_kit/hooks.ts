/** Routing and URL-state hooks shared by B2 pages. Only react-router and state/ public hooks are used. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuarters, useWorkspace, type QuarterView, type TimeBasis } from '../../../state';

/**
 * Builds workspace-scoped paths: `wsPath('plan/demand')` → `/o/:org/w/:ws/plan/demand`.
 * Reads `:org`/`:ws` from the route (SH-01) and falls back to the active workspace.
 */
export function useWsPath(): (path: string) => string {
  const params = useParams();
  const { org, workspace } = useWorkspace();
  const orgSlug = params.org ?? org?.slug ?? 'demo';
  const wsId = params.ws ?? workspace?.id ?? 'demo';
  return useCallback((path: string) => `/o/${orgSlug}/w/${wsId}/${path.replace(/^\/+/, '')}`, [orgSlug, wsId]);
}

/** One URL query parameter as state (replace navigation, so Back leaves the page, not the filter). */
export function useQueryParam(name: string, fallback = ''): [string, (v: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(name) ?? fallback;
  const set = useCallback(
    (v: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === null || v === '' || v === fallback) next.delete(name);
          else next.set(name, v);
          return next;
        },
        { replace: true },
      );
    },
    [name, fallback, setParams],
  );
  return [value, set];
}

export type BasisId = 'today' | 'qbr1' | 'qbr2' | 'qbr3' | 'qbr4' | 'window';
export const BASIS_IDS: BasisId[] = ['today', 'qbr1', 'qbr2', 'qbr3', 'qbr4', 'window'];

/** Time basis from `?basis=` (SH-03#AC2). Default QBR1. `quarterIndex` is the quarter tables highlight. */
export function useBasis(): {
  id: BasisId;
  basis: TimeBasis;
  quarters: QuarterView[];
  quarter: QuarterView | undefined;
  quarterIndex: number;
  caption: string;
  set(id: BasisId): void;
} {
  const quarters = useQuarters();
  const [raw, setRaw] = useQueryParam('basis', 'qbr1');
  const id: BasisId = (BASIS_IDS as string[]).includes(raw) ? (raw as BasisId) : 'qbr1';
  return useMemo(() => {
    const qi = id.startsWith('qbr') ? Number(id.slice(3)) - 1 : 0;
    const quarter = quarters[qi];
    const basis: TimeBasis =
      id === 'today'
        ? { kind: 'today' }
        : id === 'window'
          ? { kind: 'window' }
          : { kind: 'quarter', key: quarter?.key ?? '' };
    const caption =
      id === 'today'
        ? 'Today'
        : id === 'window'
          ? `Window · ${quarters[0]?.calendarLabel ?? ''} – ${quarters[quarters.length - 1]?.calendarLabel ?? ''}`
          : `${quarter?.label ?? ''} · ${quarter?.calendarLabel ?? ''}`;
    return { id, basis, quarters, quarter, quarterIndex: qi, caption, set: (v: BasisId) => setRaw(v) };
  }, [id, quarters, setRaw]);
}

/** Document title "{Page} · PMO Capacity Planner" (SH-01#AC1). */
export function usePageTitle(title: string): void {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · PMO Capacity Planner`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

/** Width of an element, kept current with ResizeObserver (for SVG charts drawn to scale). */
export function useElementWidth(ref: RefObject<HTMLElement | null>, initial = 640): number {
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(0, Math.round(el.getBoundingClientRect().width)));
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    const id = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(id);
      ro?.disconnect();
    };
  }, [ref]);
  return width;
}
