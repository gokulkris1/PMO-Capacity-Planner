import { useState } from 'react';
import { resolveFeatures, type FeatureFlag } from '../../shared/features';
import { useMutations, useSession } from '../../state';
import { useAiServiceReady } from '../../components/shell/AskTom';
import { Card, StatusPill, Switch, useConfirm, useToast } from '../../components/ui';
import { SectionBody, SectionHeader, errorText } from './common';

const AI_EGRESS =
  "Questions and a summary of this workspace's people, projects and allocations will be sent to Anthropic (Claude) for processing.";

const FEATURES: Array<{ flag: FeatureFlag; label: string; description: string }> = [
  {
    flag: 'aiAssistant',
    label: 'Ask Tom (AI assistant)',
    description: `Lets everyone ask Tom about the plan and about using the tool, from the button at the bottom right of every page. ${AI_EGRESS}`,
  },
  {
    flag: 'qbrSprintModule',
    label: 'Sprint planning (legacy QBR module)',
    description: 'Shows the v1 sprint-level QBR planner under Delivery. It is not connected to Allocations.',
  },
  {
    flag: 'jiraScheduledSync',
    label: 'Daily Jira sync',
    description: 'Syncs story points every night on production. You can still run "Sync now" at any time.',
  },
];

/** Settings › Features (ST-05, SH-05, HS-11#AC2). Org Admin only; each change is audited server-side. */
export default function FeaturesSettings() {
  const { me } = useSession();
  const m = useMutations();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<FeatureFlag | null>(null);
  const features = resolveFeatures(me?.org?.features);
  const aiReady = useAiServiceReady();
  const unavailable = (flag: FeatureFlag) => flag === 'aiAssistant' && !aiReady && !features.aiAssistant;

  const toggle = async (flag: FeatureFlag, on: boolean) => {
    if (flag === 'aiAssistant' && on) {
      const ok = await confirm({
        title: 'Turn on Ask Tom?',
        body: AI_EGRESS,
        confirmLabel: 'Turn on',
        tone: 'primary',
      });
      if (!ok) return;
    }
    setBusy(flag);
    try {
      await m.admin.updateOrg({ features: { ...features, [flag]: on } });
      toast.success(`${FEATURES.find((f) => f.flag === flag)?.label ?? 'Feature'} is ${on ? 'on' : 'off'}`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionHeader id="features" />
      <SectionBody>
        <Card>
          <div className="pcp-stack pcp-stack--md">
            {FEATURES.map((f) => (
              <div key={f.flag} className="pcp-settings__row">
                <Switch
                  checked={features[f.flag]}
                  disabled={busy === f.flag || unavailable(f.flag)}
                  onChange={(on) => void toggle(f.flag, on)}
                  label={<span className="pcp-settings__row-title">{f.label}</span>}
                  description={
                    unavailable(f.flag)
                      ? "Not available yet: no AI service is connected to this site. Whoever runs PMO Capacity Planner needs to connect one first."
                      : f.description
                  }
                />
                <StatusPill tone={features[f.flag] ? 'success' : 'neutral'}>
                  {features[f.flag] ? 'On' : 'Off'}
                </StatusPill>
              </div>
            ))}
          </div>
        </Card>
      </SectionBody>
    </>
  );
}
