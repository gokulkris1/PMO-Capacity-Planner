/** Interim PageHeader (DESIGN_SYSTEM §8.2, SH-03) and page-level data states. Swap: components/ui PageHeader. */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, CircleAlert, RefreshCw } from 'lucide-react';
import { useConflict, useWorkspaceData } from '../../../state';
import { BASIS_IDS, useBasis, usePageTitle, type BasisId } from './hooks';
import { quarterTooltip } from './format';
import { Banner, Button, SegmentedControl, Skeleton } from './primitives';
import { ToastViewport } from './overlays';

export interface Crumb {
  label: string;
  to?: string;
}

export function BasisControl({ exclude = [] }: { exclude?: BasisId[] }) {
  const b = useBasis();
  const items = BASIS_IDS.filter((id) => !exclude.includes(id)).map((id) => {
    const q = id.startsWith('qbr') ? b.quarters[Number(id.slice(3)) - 1] : undefined;
    return {
      id,
      label: id === 'today' ? 'Today' : id === 'window' ? 'Window' : (q?.label ?? id.toUpperCase()),
      title: q ? quarterTooltip(q) : id === 'today' ? 'Bookings active today' : 'Average across QBR1–QBR4',
    };
  });
  return <SegmentedControl size="sm" label="Time basis" items={items} value={b.id} onChange={b.set} />;
}

export function PageHeader({
  crumbs,
  title,
  description,
  actions,
  basis,
  basisExclude,
  tabs,
  meta,
}: {
  crumbs: Crumb[];
  title: string;
  description?: string;
  actions?: ReactNode;
  basis?: boolean;
  basisExclude?: BasisId[];
  tabs?: ReactNode;
  meta?: ReactNode;
}) {
  usePageTitle(title);
  return (
    <header className="b2-ph">
      <nav className="b2-ph__crumbs" aria-label="Breadcrumb">
        <ol>
          {crumbs.map((c, i) => (
            <li key={`${c.label}-${i}`}>
              {i > 0 && <ChevronRight size={12} strokeWidth={1.75} aria-hidden="true" />}
              {c.to && i < crumbs.length - 1 ? (
                <Link to={c.to}>{c.label}</Link>
              ) : (
                <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="b2-ph__main">
        <h1 className="b2-ph__title">{title}</h1>
        {actions && <div className="b2-ph__actions">{actions}</div>}
      </div>
      {(description || basis || meta) && (
        <div className="b2-ph__meta">
          {description ? (
            <p className="b2-ph__desc" title={description}>
              {description}
            </p>
          ) : (
            <span className="b2-spacer" />
          )}
          {meta}
          {basis && <BasisControl exclude={basisExclude} />}
        </div>
      )}
      {tabs && <div className="b2-ph__tabs">{tabs}</div>}
    </header>
  );
}

/**
 * Wraps a page body with the workspace data states: skeleton while loading, a danger Banner with Retry on
 * error, and the children (render prop receiving the snapshot) when ready. Also mounts the toast viewport.
 */
export function PageBody({
  skeleton = 'table',
  label,
  children,
}: {
  skeleton?: 'table' | 'kpi' | 'chart';
  label: string;
  children: (snapshot: NonNullable<ReturnType<typeof useWorkspaceData>['snapshot']>) => ReactNode;
}) {
  const data = useWorkspaceData();
  const { conflict, resolve } = useConflict();
  let body: ReactNode;
  if (data.status === 'error') {
    body = (
      <Banner
        tone="danger"
        title={`We couldn't load ${label}.`}
        action={
          <Button size="sm" icon={RefreshCw} onClick={() => void data.reload()}>
            Retry
          </Button>
        }
      >
        {data.error?.requestId
          ? `Try again, or quote reference ${data.error.requestId}.`
          : 'Check your connection and try again.'}
      </Banner>
    );
  } else if (data.status === 'loading' || !data.snapshot) {
    body =
      skeleton === 'kpi' ? (
        <div className="b2-stack">
          <Skeleton variant="kpi" label={label} />
          <Skeleton variant="chart" label={label} />
        </div>
      ) : (
        <Skeleton variant={skeleton} label={label} />
      );
  } else {
    body = children(data.snapshot);
  }
  return (
    <>
      {conflict && (
        <div className="b2-conflict">
          <Banner
            tone="warning"
            title={`${conflict.name} was changed by ${conflict.changedBy}`}
            action={
              <span className="b2-row">
                <Button size="sm" variant="primary" icon={RefreshCw} onClick={() => resolve('reload')}>
                  Reload
                </Button>
                <Button size="sm" variant="subtle" onClick={() => resolve('dismiss')}>
                  Dismiss
                </Button>
              </span>
            }
          >
            Your last change to this {conflict.entity} was not saved. Reload to see the latest version, then try again.
          </Banner>
        </div>
      )}
      {body}
      <ToastViewport />
    </>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <span className="b2-field__error" role="alert">
      <CircleAlert size={12} strokeWidth={2} aria-hidden="true" />
      {children}
    </span>
  );
}
