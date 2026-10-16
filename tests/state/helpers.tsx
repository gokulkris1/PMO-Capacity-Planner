import type { ReactNode } from 'react';
import { DemoTransport, type DemoTransportOptions } from '../../services/api/demoTransport';
import { DataRuntime } from '../../state/runtime';
import { DataProvider } from '../../state/session';

export function memoryStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

export function setupRuntime(o: DemoTransportOptions & { storage?: ReturnType<typeof memoryStorage> } = {}) {
  const storage = o.storage ?? memoryStorage();
  const transport = new DemoTransport({ acceptAnyPassword: false, ...o, storage: null });
  let nowMs = 1_000_000;
  const rt = new DataRuntime({ transport, storage, refetchAfterMs: 60_000, nowMs: () => nowMs });
  const wrapper = ({ children }: { children?: ReactNode }) => <DataProvider runtime={rt}>{children}</DataProvider>;
  return {
    rt,
    transport,
    storage,
    wrapper,
    advance(ms: number) {
      nowMs += ms;
    },
  };
}
