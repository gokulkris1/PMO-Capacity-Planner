/**
 * Page-level data states for workspace pages: skeleton while the snapshot loads, a danger Banner with Retry when it
 * fails, otherwise the children (render prop receiving the snapshot). Conflicts are shown by the shell's
 * "This record changed" dialog and toasts by the shell's ToastProvider, so pages never mount their own.
 */
import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useWorkspaceData } from '../../state';
import type { WorkspaceSnapshot } from '../../shared/contracts/dto';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';

export function PageBody({
  skeleton = 'table',
  label,
  children,
}: {
  skeleton?: 'table' | 'kpi' | 'chart';
  label: string;
  children: (snapshot: WorkspaceSnapshot) => ReactNode;
}) {
  const data = useWorkspaceData();
  if (data.status === 'error') {
    return (
      <Banner
        tone="danger"
        title={`We couldn't load ${label}.`}
        actionNode={
          <Button size="sm" iconBefore={RefreshCw} onClick={() => void data.reload()}>
            Retry
          </Button>
        }
      >
        {data.error?.requestId
          ? `Try again, or quote reference ${data.error.requestId}.`
          : 'Check your connection and try again.'}
      </Banner>
    );
  }
  if (data.status === 'loading' || !data.snapshot) {
    return skeleton === 'kpi' ? (
      <div className="pcp-stack">
        <Skeleton variant="kpi" label={label} />
        <Skeleton variant="chart" label={label} />
      </div>
    ) : (
      <Skeleton variant={skeleton} label={label} />
    );
  }
  return <>{children(data.snapshot)}</>;
}
