/**
 * Runs a mutation with consistent feedback: busy flag, success toast (optionally with Undo via useUndo),
 * error toast with plain-language text, and 409 conflicts surfaced with a "Reload" action.
 */
import { useCallback, useState } from 'react';
import { useUndo, useWorkspaceData } from '../../state';
import { errorMessage } from './format';
import { useToast } from './Toast';

export interface ActionOptions {
  success?: string;
  body?: string;
  undo?: boolean;
}

export function useAction(): {
  busy: string | null;
  run<T>(key: string, fn: () => Promise<T>, opts?: ActionOptions): Promise<{ ok: boolean; value?: T }>;
} {
  const [busy, setBusy] = useState<string | null>(null);
  const undo = useUndo();
  const data = useWorkspaceData();
  const toast = useToast();
  const run = useCallback(
    async <T>(key: string, fn: () => Promise<T>, opts?: ActionOptions): Promise<{ ok: boolean; value?: T }> => {
      setBusy(key);
      try {
        const out = await fn();
        if (opts?.success)
          toast.success(opts.success, {
            body: opts.body,
            action: opts.undo ? { label: 'Undo', onAction: () => void undo.undo() } : undefined,
          });
        return { ok: true, value: out };
      } catch (e) {
        const status = (e as { status?: number }).status;
        toast.error(status === 409 ? 'This changed since you loaded it' : 'That did not work', {
          body: errorMessage(e),
          action: status === 409 ? { label: 'Reload', onAction: () => void data.reload() } : undefined,
        });
        return { ok: false };
      } finally {
        setBusy(null);
      }
    },
    [undo, data, toast],
  );
  return { busy, run };
}
