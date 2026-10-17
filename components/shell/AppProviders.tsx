import type { ReactNode } from 'react';
import { useConflict } from '../../state';
import { ToastProvider } from '../ui/Toast';
import { ConfirmProvider } from '../ui/Dialog';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { formatDate } from '../ui/hooks';

/** Global "This record changed" dialog driven by useConflict() (BACKLOG §3 common copy). */
function ConflictDialog() {
  const { conflict, resolve } = useConflict();
  if (!conflict) return null;
  const when = (() => {
    const d = new Date(conflict.changedAt);
    return Number.isNaN(d.getTime())
      ? conflict.changedAt
      : `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} on ${formatDate(conflict.changedAt)}`;
  })();
  return (
    <Dialog
      open
      size="sm"
      onClose={() => resolve('dismiss')}
      title="This record changed"
      footer={
        <>
          <Button variant="secondary" onClick={() => resolve('dismiss')} data-autofocus="">
            Keep editing
          </Button>
          <Button variant="primary" onClick={() => resolve('reload')}>
            Reload
          </Button>
        </>
      }
    >
      <p className="pcp-text-secondary">
        {conflict.changedBy} changed it at {when}. Reload to see the latest version, or keep your edits and try again.
      </p>
    </Dialog>
  );
}

/** Toasts, confirmations and the conflict dialog; mounted once by App.tsx (DS-03). */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        {children}
        <ConflictDialog />
      </ConfirmProvider>
    </ToastProvider>
  );
}
