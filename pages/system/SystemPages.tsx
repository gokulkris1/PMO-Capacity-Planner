import type { ReactNode } from 'react';
import { Compass, RefreshCw, ServerCog, ShieldAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Button, LinkButton } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { useDocumentTitle } from '../../components/ui/hooks';
import { useWorkspaceBase } from '../../components/shell/workspacePath';
import { Wordmark } from '../../components/shell/ProductMark';
import { cx } from '../../components/ui/internal/utils';
import { userMessage, type ApiRequestError } from '../../services/api/errors';
import './system.css';

interface SystemMessageProps {
  icon: LucideIcon;
  /** Short status word above the title, e.g. "Error 404". */
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** Full page (outside the shell) adds the wordmark and centres in the viewport. */
  fullPage?: boolean;
  tone?: 'neutral' | 'danger' | 'warning';
  documentTitle?: string;
}

/** Shared layout for 404, 403, error and maintenance messages (SH-07). */
export function SystemMessage({
  icon,
  eyebrow,
  title,
  children,
  actions,
  fullPage,
  tone = 'neutral',
  documentTitle,
}: SystemMessageProps) {
  useDocumentTitle(documentTitle ?? title);
  const body = (
    <div className={cx('pcp-system', `pcp-system--${tone}`)} role={tone === 'danger' ? 'alert' : undefined}>
      <span className="pcp-system__icon">
        <Icon icon={icon} size={24} />
      </span>
      {eyebrow ? <p className="pcp-system__eyebrow">{eyebrow}</p> : null}
      <h1 className="pcp-system__title">{title}</h1>
      {children ? <div className="pcp-system__body">{children}</div> : null}
      {actions ? <div className="pcp-system__actions">{actions}</div> : null}
    </div>
  );
  if (!fullPage) return <div className="pcp-system-wrap">{body}</div>;
  return (
    <div className="pcp-system-page">
      <div className="pcp-system-page__brand">
        <Wordmark />
      </div>
      <main id="main" tabIndex={-1} className="pcp-system-page__main">
        {body}
      </main>
    </div>
  );
}

/** 404 "Page not found" with "Go to Home" (SH-07#AC2). */
export function NotFoundPage({ fullPage }: { fullPage?: boolean }) {
  const base = useWorkspaceBase();
  return (
    <SystemMessage
      icon={Compass}
      eyebrow="Error 404"
      title="Page not found"
      fullPage={fullPage ?? !base}
      actions={
        <LinkButton variant="primary" to={base ? `${base}/home` : '/'}>
          Go to Home
        </LinkButton>
      }
    >
      <p>The link may be out of date, or the page has moved. Check the address or start again from Home.</p>
    </SystemMessage>
  );
}

/** 403 "You don't have access to this {workspace|page}" with the role needed when known (SH-07#AC3). */
export function ForbiddenPage({
  scope = 'page',
  requiredRole,
  homeHref,
  fullPage,
}: {
  scope?: 'workspace' | 'page';
  requiredRole?: string;
  /** Where "Go to my workspace" leads (default workspace home). */
  homeHref?: string;
  fullPage?: boolean;
}) {
  const base = useWorkspaceBase();
  const target = homeHref ?? (base ? `${base}/home` : '/');
  return (
    <SystemMessage
      icon={ShieldAlert}
      eyebrow="Error 403"
      title={`You don't have access to this ${scope}`}
      fullPage={fullPage}
      actions={
        <LinkButton variant="primary" to={target}>
          {scope === 'workspace' ? 'Go to my workspace' : 'Go to Home'}
        </LinkButton>
      }
    >
      <p>
        {requiredRole
          ? `You need the ${requiredRole} role to open it. Ask your PMO Admin or Org Admin for access.`
          : 'Ask your PMO Admin or Org Admin if you need access.'}
      </p>
    </SystemMessage>
  );
}

/**
 * 503 migration_pending: full-page update notice with "Try again" (SH-07#AC4). With `autoRetry` the data runtime
 * is already checking again every few seconds and opens the workspace as soon as the API is ready (QA-011).
 */
export function MaintenancePage({ onRetry, autoRetry = false }: { onRetry?: () => void; autoRetry?: boolean }) {
  return (
    <SystemMessage
      icon={ServerCog}
      eyebrow="Scheduled update"
      title="PMO Capacity Planner is being updated"
      documentTitle="Updating"
      fullPage
      tone="warning"
      actions={
        <Button variant="primary" iconBefore={RefreshCw} onClick={onRetry ?? (() => window.location.reload())}>
          Try again
        </Button>
      }
    >
      <p>This usually takes under a minute. Your data is safe; nothing you saved is lost.</p>
      {autoRetry ? (
        <p className="pcp-system__status" role="status" aria-live="polite">
          <span className="pcp-system__pulse" aria-hidden="true" />
          Checking again automatically. Your workspace opens as soon as the update is done.
        </p>
      ) : null}
    </SystemMessage>
  );
}

/** The session could not load for a reason other than maintenance (network, 500): never an endless spinner. */
export function BootErrorPage({ error, onRetry }: { error: ApiRequestError; onRetry: () => void }) {
  return (
    <SystemMessage
      icon={TriangleAlert}
      title="We couldn't open PMO Capacity Planner"
      documentTitle="Something went wrong"
      fullPage
      tone="danger"
      actions={
        <Button variant="primary" iconBefore={RefreshCw} onClick={onRetry}>
          Try again
        </Button>
      }
    >
      <p>{userMessage(error)}</p>
    </SystemMessage>
  );
}

/** Page-area error (render error inside a page; the shell stays usable) (SH-07#AC1). */
export function PageErrorFallback({ reference, onReload }: { reference: string; onReload: () => void }) {
  return (
    <SystemMessage
      icon={TriangleAlert}
      title="This page hit a problem"
      tone="danger"
      actions={
        <Button variant="primary" iconBefore={RefreshCw} onClick={onReload}>
          Reload page
        </Button>
      }
    >
      <p>
        Reload the page to try again. If it keeps happening, quote reference{' '}
        <code className="pcp-system__ref">{reference}</code> to your PMO Admin.
      </p>
    </SystemMessage>
  );
}
