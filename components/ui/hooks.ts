import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { useSearchParams } from 'react-router-dom';

export const PRODUCT_NAME = 'PMO Capacity Planner';

/**
 * React Router hands every functional `setSearchParams` update the params of the last render, so two updates in
 * the same event (e.g. closing a dialog clears `?edit=` and `?project=`) overwrite each other. Chain them: an
 * update that starts from the same stale params as the previous one in this tick builds on its result instead.
 */
let pendingParams: { from: string; next: URLSearchParams } | null = null;
function chainParams(prev: URLSearchParams, apply: (p: URLSearchParams) => void): URLSearchParams {
  const from = prev.toString();
  const base = pendingParams && pendingParams.from === from ? pendingParams.next : prev;
  const next = new URLSearchParams(base);
  apply(next);
  pendingParams = { from, next };
  setTimeout(() => {
    if (pendingParams?.next === next) pendingParams = null;
  }, 0);
  return next;
}

/** Sets `document.title` to "{title} · PMO Capacity Planner" (SH-01#AC1). */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${PRODUCT_NAME}` : PRODUCT_NAME;
  }, [title]);
}

/**
 * A single URL search param as state (drawers `?person=`, filters). Setting null removes it.
 * Pushes a history entry by default so Back closes a drawer (DS-03#AC5).
 */
export function useUrlParam(
  name: string,
  opts: { replace?: boolean } = {},
): [string | null, (v: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(name);
  const replace = opts.replace ?? false;
  const set = useCallback(
    (v: string | null) => {
      setParams(
        (prev) =>
          chainParams(prev, (next) => {
            if (v === null || v === '') next.delete(name);
            else next.set(name, v);
          }),
        { replace },
      );
    },
    [setParams, name, replace],
  );
  return [value, set];
}

/**
 * A URL query parameter used as a filter (`?craft=`, `?tab=`): replace navigation, so Back leaves the page rather
 * than undoing a filter; the fallback value is never written to the URL.
 */
export function useQueryParam(name: string, fallback = ''): [string, (v: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(name) ?? fallback;
  const set = useCallback(
    (v: string | null) => {
      setParams(
        (prev) =>
          chainParams(prev, (next) => {
            if (v === null || v === '' || v === fallback) next.delete(name);
            else next.set(name, v);
          }),
        { replace: true },
      );
    },
    [name, fallback, setParams],
  );
  return [value, set];
}

/** Width of an element, kept current with ResizeObserver (for charts drawn to scale). */
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

/** Subscribes to a CSS media query, e.g. useMediaQuery('(max-width: 767px)'). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Formats a number as a rounded percentage with tabular digits expected from the caller's CSS. */
export function formatPct(value: number): string {
  return `${Math.round(value)}%`;
}

/** One decimal for FTE ("0.5 FTE"). */
export function formatFte(value: number, withUnit = true): string {
  const v = Math.round(value * 10) / 10;
  return withUnit ? `${v.toFixed(1)} FTE` : v.toFixed(1);
}

/** "16 Oct 2026" style dates (d MMM yyyy) for read-only contexts. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
