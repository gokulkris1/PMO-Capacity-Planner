import type { ComponentType } from 'react';
import { Hammer } from 'lucide-react';
import { LinkButton } from '../ui/Button';
import { PageHeader } from '../ui/PageHeader';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { useWsPath } from './workspacePath';

export interface PlaceholderSpec {
  title: string;
  /** Breadcrumb area, e.g. "Plan". */
  area?: string;
  /** Story id(s), e.g. "RP-02". */
  story: string;
  /** The B2 module the integrator points this route at, e.g. "pages/plan/CapacityOutlookPage.tsx". */
  module: string;
  description?: string;
}

/**
 * Stand-in for a B2-owned page until the integrator points `components/shell/pages.manifest.ts` at the real
 * module. Renders inside the shell so routing, titles and navigation can be verified end to end.
 */
export function RoutePlaceholder({ spec }: { spec: PlaceholderSpec }) {
  const to = useWsPath();
  return (
    <>
      <PageHeader
        title={spec.title}
        breadcrumbs={spec.area ? [{ label: spec.area }, { label: spec.title }] : undefined}
        description={spec.description}
      />
      <div className="pcp-page">
        <Card>
          <EmptyState
            icon={Hammer}
            title={`${spec.title} is being rebuilt`}
            description={`This view (${spec.story}) is delivered by the pages package and plugs into this route from ${spec.module}.`}
            secondaryAction={
              <LinkButton variant="link" to={to('home')}>
                Back to Home
              </LinkButton>
            }
          />
        </Card>
      </div>
    </>
  );
}

/** Lazy-import shape for React.lazy: `lazy(() => placeholder({...}))`. */
export function placeholder(spec: PlaceholderSpec): Promise<{ default: ComponentType }> {
  const Page = () => <RoutePlaceholder spec={spec} />;
  return Promise.resolve({ default: Page });
}
