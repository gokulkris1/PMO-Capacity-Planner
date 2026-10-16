/**
 * Sprint planning (SH-05#AC2, D-5) — route `/o/:org/w/:ws/delivery/sprints`, only when the `qbrSprintModule`
 * flag is on. Hosts the legacy QBR sprint module (`components/qbr/**`, lint-exempt legacy code) inside the
 * new page frame, loaded lazily so it never ships in the main chunk. After the router swap the integrator moves
 * `components/qbr/**` to `pages/delivery/sprints/legacy/` (see docs/release/handoff-B2.md §5).
 */
import { lazy, Suspense } from 'react';
import { CalendarDays } from 'lucide-react';
import { useFeature, useWorkspace } from '../../../state';
import { Card, EmptyState, PageHeader, Skeleton } from '../../plan/_kit';

const QBRPlanner = lazy(() => import('../../../components/qbr/QBRPlanner').then((m) => ({ default: m.QBRPlanner })));

export default function SprintsPage() {
  const enabled = useFeature('qbrSprintModule');
  const { org, workspace } = useWorkspace();
  return (
    <div className="b2-page">
      <PageHeader
        crumbs={[{ label: 'Delivery' }, { label: 'Sprint planning' }]}
        title="Sprint planning"
        description="Legacy QBR sprint module. It keeps its own members and projects until it is unified with the core plan."
      />
      {!enabled || !org || !workspace ? (
        <Card>
          <EmptyState icon={CalendarDays} title="Sprint planning is turned off" body="An Org Admin can switch it on in Settings › Features." />
        </Card>
      ) : (
        <Suspense fallback={<Skeleton variant="table" label="sprint planning" />}>
          {/* Session auth is cookie-based in 2.0 (AC-03); the legacy module's bearer token is not needed. */}
          <QBRPlanner token="" wsId={workspace.id} orgId={org.id} />
        </Suspense>
      )}
    </div>
  );
}
