/**
 * A tiny external store (PL-06): `getState`/`subscribe` for `useSyncExternalStore`, plus `setState`
 * with an updater. No dependency, no React import.
 */
export interface Store<S> {
  getState(): S;
  setState(update: (s: S) => S): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(update) {
      const next = update(state);
      if (next === state) return;
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
