/**
 * Data-layer provider and runtime selection (PL-06; replaces `context/AuthContext.tsx`).
 *
 * Mount `<DataProvider>` once at the root, above the router (see docs/release/handoff-C.md §4).
 * Without a provider the hooks fall back to one module-level runtime created from the current URL,
 * so code written against the WP-0 stubs keeps working.
 *
 * Transport selection: `/demo…` paths, `?demo=1`, or `forceDemo` (e.g. `import.meta.env.MODE ===
 * 'demo'` for `npm run dev:demo`) → DemoTransport; otherwise HttpTransport.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DemoTransport, demoOptionsFromSearch } from '../services/api/demoTransport';
import { HttpTransport } from '../services/api/httpTransport';
import type { Transport } from '../services/api/transport';
import { DataRuntime, type StorageLike } from './runtime';

export type DataMode = 'live' | 'demo';

interface LocationLike {
  pathname: string;
  search: string;
}

function browserLocation(): LocationLike | null {
  try {
    return typeof window !== 'undefined' && window.location ? window.location : null;
  } catch {
    return null;
  }
}

function browserStorage(kind: 'localStorage' | 'sessionStorage'): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window[kind] : null;
  } catch {
    return null;
  }
}

/** Demo when the path is `/demo` or below it, or the query has `demo=1`, or `forceDemo` is set. */
export function selectMode(loc: LocationLike | null, forceDemo = false): DataMode {
  if (forceDemo) return 'demo';
  if (!loc) return 'live';
  if (loc.pathname === '/demo' || loc.pathname.startsWith('/demo/')) return 'demo';
  return new URLSearchParams(loc.search).get('demo') === '1' ? 'demo' : 'live';
}

export interface CreateRuntimeOptions {
  mode?: DataMode;
  forceDemo?: boolean;
  transport?: Transport;
  location?: LocationLike | null;
  /** UI-preference storage; defaults to window.localStorage. */
  storage?: StorageLike | null;
  /** Demo persistence; defaults to window.sessionStorage. Pass null for in-memory only. */
  demoStorage?: StorageLike | null;
}

export function createDataRuntime(o: CreateRuntimeOptions = {}): DataRuntime {
  const loc = o.location === undefined ? browserLocation() : o.location;
  const mode: DataMode = o.transport
    ? o.transport.kind === 'demo'
      ? 'demo'
      : 'live'
    : (o.mode ?? selectMode(loc, o.forceDemo));
  const transport =
    o.transport ??
    (mode === 'demo'
      ? new DemoTransport({
          ...demoOptionsFromSearch(loc?.search ?? ''),
          storage: o.demoStorage === undefined ? browserStorage('sessionStorage') : o.demoStorage,
        })
      : new HttpTransport());
  return new DataRuntime({
    transport,
    mode,
    storage: o.storage === undefined ? browserStorage('localStorage') : o.storage,
  });
}

let fallback: DataRuntime | null = null;

/** The runtime used by hooks rendered outside a `DataProvider`. */
export function getDefaultRuntime(): DataRuntime {
  if (!fallback) fallback = createDataRuntime();
  return fallback;
}

/** Test helper: forget the fallback runtime. */
export function resetDefaultRuntime(): void {
  fallback = null;
}

const RuntimeContext = createContext<DataRuntime | null>(null);

export interface DataProviderProps {
  children?: ReactNode;
  /** Use this runtime (tests, storybook). */
  runtime?: DataRuntime;
  /** Force a mode instead of reading the URL. */
  mode?: DataMode;
  /** True for `npm run dev:demo` (`import.meta.env.MODE === 'demo'`). */
  forceDemo?: boolean;
  /** Use this transport (e.g. a future ForgeBridgeTransport). */
  transport?: Transport;
}

/** Owns the data runtime: boots the session, refetches on focus (AC-04#AC3, PL-06#AC3). */
export function DataProvider({ children, runtime, mode, forceDemo, transport }: DataProviderProps) {
  const [rt] = useState(() => runtime ?? createDataRuntime({ mode, forceDemo, transport }));
  useEffect(() => {
    void rt.start();
    if (typeof window === 'undefined') return undefined;
    const onFocus = () => void rt.onFocus();
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void rt.onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [rt]);
  return <RuntimeContext.Provider value={rt}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): DataRuntime {
  return useContext(RuntimeContext) ?? getDefaultRuntime();
}
