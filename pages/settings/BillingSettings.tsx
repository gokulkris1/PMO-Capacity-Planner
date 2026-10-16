import { useState } from 'react';
import { BadgeCheck, Check } from 'lucide-react';
import { PLAN_ENTITLEMENTS, type Entitlements, type Plan } from '../../shared/entitlements';
import { useEntitlements, useSession, useWorkspaceData } from '../../state';
import { Banner, Button, Card, Dialog, Icon, StatusPill, useToast } from '../../components/ui';
import { useClientGaps } from '../../state';
import { cx } from '../../components/ui/internal/utils';
import { NotFoundPage } from '../system/SystemPages';
import { SectionBody, SectionHeader, errorText } from './common';

const PLANS: Plan[] = ['BASIC', 'PRO', 'MAX', 'ENTERPRISE'];
const PLAN_NAME: Record<Plan, string> = { BASIC: 'Basic', PRO: 'Pro', MAX: 'Max', ENTERPRISE: 'Enterprise' };
const limit = (n: number | null) => (n === null ? 'Unlimited' : String(n));

function features(e: Entitlements): string[] {
  return [
    `${limit(e.maxPeople)} people`,
    `${limit(e.maxProjects)} projects`,
    `${limit(e.maxWorkspaces)} workspace${e.maxWorkspaces === 1 ? '' : 's'}`,
    `${limit(e.aiQueriesPerMonth)} AI questions a month`,
    ...(e.scenarios ? ['Scenarios'] : []),
    ...(e.csvImport ? ['CSV import and export'] : []),
  ];
}

function Usage({ label, used, max }: { label: string; used: number | null; max: number | null }) {
  const pct = max && used !== null ? Math.min(100, Math.round((100 * used) / max)) : 0;
  return (
    <div className="pcp-settings__usage-item">
      <span className="pcp-caption-strong pcp-text-secondary">{label}</span>
      <span className="pcp-settings__usage-value">
        {used ?? '—'}
        <span className="pcp-caption pcp-text-tertiary"> / {limit(max)}</span>
      </span>
      {max && used !== null ? (
        <div className="pcp-settings__meter" role="img" aria-label={`${used} of ${max} used`}>
          <div className="pcp-settings__meter-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/** Settings › Billing (ST-06): public mode only; plan, limits and usage, "Change plan". */
export default function BillingSettings() {
  const { me } = useSession();
  const ent = useEntitlements();
  const { snapshot } = useWorkspaceData();
  const gaps = useClientGaps();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Plan | null>(null);

  if (me?.appMode !== 'public') return <NotFoundPage />;

  const checkout = async (plan: Plan) => {
    setBusy(plan);
    try {
      const { url } = await gaps.org.startCheckout(plan);
      window.location.assign(url);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionHeader id="billing" />
      <SectionBody>
        <Card
          title={`${PLAN_NAME[ent.plan]} plan`}
          actions={
            <StatusPill tone="brand" icon={BadgeCheck}>
              Current
            </StatusPill>
          }
          footer={
            <div className="pcp-settings__footer">
              <Button variant="primary" onClick={() => setOpen(true)}>
                Change plan
              </Button>
            </div>
          }
        >
          <div className="pcp-settings__usage">
            <Usage label="People" used={snapshot?.people.length ?? 0} max={ent.maxPeople} />
            <Usage label="Projects" used={snapshot?.projects.length ?? 0} max={ent.maxProjects} />
            {/* Usage count is not in the client contract yet (handoff-B1 §5); shown as "—". */}
            <Usage label="AI questions this month" used={null} max={ent.aiQueriesPerMonth} />
          </div>
        </Card>
        <Banner tone="neutral">
          Limits only stop you creating more. Existing people and projects stay readable and editable.
        </Banner>
      </SectionBody>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Change plan"
        subtitle="Payment is handled by Stripe Checkout."
      >
        <div className="pcp-settings__plan-grid">
          {PLANS.filter((p) => PLAN_ENTITLEMENTS[p].billingVisible).map((p) => {
            const e = PLAN_ENTITLEMENTS[p];
            const current = p === ent.plan;
            return (
              <div key={p} className={cx('pcp-settings__plan', current && 'pcp-settings__plan--current')}>
                <span className="pcp-settings__plan-name">{PLAN_NAME[p]}</span>
                <ul>
                  {features(e).map((f) => (
                    <li key={f} className="pcp-row">
                      <Icon icon={Check} size={12} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  variant={current ? 'secondary' : 'primary'}
                  disabled={current}
                  loading={busy === p}
                  onClick={() => void checkout(p)}
                >
                  {current ? 'Current plan' : `Choose ${PLAN_NAME[p]}`}
                </Button>
              </div>
            );
          })}
        </div>
      </Dialog>
    </>
  );
}
