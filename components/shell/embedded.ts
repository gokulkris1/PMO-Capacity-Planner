import { useEffect, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EMBEDDED_BY_ENV } from './env';

const KEY = 'pcp.ui.embedded';
const listeners = new Set<() => void>();

function read(): boolean {
  if (EMBEDDED_BY_ENV) return true;
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function write(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(KEY, '1');
    else window.sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

/**
 * Embedded shell mode (SH-02#AC6): `?embedded=1` (or VITE_EMBEDDED=true) hides the sidebar and top bar and
 * persists for the browser session while navigating; `?embedded=0` leaves it. Sets `data-embedded` on <html>
 * so tokens switch to the 16 px gutter.
 */
export function useEmbedded(): boolean {
  const [params] = useSearchParams();
  const flag = params.get('embedded');
  useEffect(() => {
    if (flag === '1' || flag === 'true') write(true);
    else if (flag === '0' || flag === 'false') write(false);
  }, [flag]);
  const stored = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => EMBEDDED_BY_ENV,
  );
  const on = flag === '1' || flag === 'true' ? true : flag === '0' || flag === 'false' ? false : stored;
  useEffect(() => {
    const html = document.documentElement;
    if (on) html.dataset.embedded = 'standalone';
    else delete html.dataset.embedded;
  }, [on]);
  return on;
}
