import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, PlugZap, RefreshCw, SquareKanban, CalendarRange } from 'lucide-react';
import { useWorkspace } from '../../state';
import {
  Banner,
  Button,
  Card,
  FormField,
  PasswordField,
  Select,
  Skeleton,
  StatusPill,
  Switch,
  TextField,
  formatDate,
  useToast,
} from '../../components/ui';
import { useClientGaps, type JiraConnection, type PlanviewConnection } from '../../state';
import { SectionBody, SectionHeader, errorText } from './common';

const STATUS: Record<JiraConnection['status'], { tone: 'neutral' | 'success' | 'danger'; label: string }> = {
  not_connected: { tone: 'neutral', label: 'Not connected' },
  connected: { tone: 'success', label: 'Connected' },
  error: { tone: 'danger', label: 'Error' },
};

/** UAT-03: "acme.atlassian.net" and "https://acme.atlassian.net" are both a Jira Cloud site. */
const JIRA_SITE_RE = /^(https:\/\/)?[a-z0-9][a-z0-9-]*\.atlassian\.net\/?$/i;
const JIRA_SITE_MESSAGE = 'Use your Jira Cloud site, e.g. acme.atlassian.net';

const list = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Settings › Integrations (ST-04): connection setup. Planners read; PMO Admins manage; secrets write-only. */
export default function IntegrationsSettings() {
  const { can } = useWorkspace();
  const gaps = useClientGaps();
  const toast = useToast();
  const manage = can('integrations.manage');
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error';
    jira?: JiraConnection;
    planview?: PlanviewConnection;
  }>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const res = await gaps.integrations.get();
      setState({ status: 'ready', ...res });
    } catch {
      setState({ status: 'error' });
    }
  }, [gaps]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load; state is set after the request resolves
    void load();
  }, [load]);

  return (
    <>
      <SectionHeader id="integrations" />
      <SectionBody>
        {!manage ? (
          <Banner tone="info">You can see the connection status. PMO Admins manage connections and secrets.</Banner>
        ) : null}
        {state.status === 'loading' ? (
          <Card>
            <Skeleton variant="text" lines={5} label="integrations" />
          </Card>
        ) : state.status === 'error' || !state.jira || !state.planview ? (
          <Banner tone="danger" action={{ label: 'Retry', onClick: () => void load() }}>
            {"We couldn't load the integration settings."}
          </Banner>
        ) : (
          <>
            <JiraCard initial={state.jira} manage={manage} onSaved={() => void load()} gaps={gaps} toast={toast} />
            <PlanviewCard initial={state.planview} manage={manage} gaps={gaps} toast={toast} />
          </>
        )}
      </SectionBody>
    </>
  );
}

type Gaps = ReturnType<typeof useClientGaps>;
type Toast = ReturnType<typeof useToast>;

function JiraCard({
  initial,
  manage,
  onSaved,
  gaps,
  toast,
}: {
  initial: JiraConnection;
  manage: boolean;
  onSaved: () => void;
  gaps: Gaps;
  toast: Toast;
}) {
  const [site, setSite] = useState(initial.siteUrl);
  const [email, setEmail] = useState(initial.email);
  const [token, setToken] = useState('');
  const [keys, setKeys] = useState(initial.projectKeys.join(', '));
  const [boards, setBoards] = useState(initial.boardIds.join(', '));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<null | { ok: boolean; message: string; field: string | null }>(
    initial.storyPointField
      ? { ok: true, message: 'Story points field detected.', field: initial.storyPointField }
      : null,
  );
  const [siteError, setSiteError] = useState<string | null>(null);
  const st = STATUS[initial.status];

  const siteOk = () => {
    const ok = !site.trim() || JIRA_SITE_RE.test(site.trim());
    setSiteError(ok ? null : JIRA_SITE_MESSAGE);
    return ok;
  };

  const save = async () => {
    if (!siteOk()) return;
    setSaving(true);
    try {
      await gaps.integrations.saveJira({
        siteUrl: site.trim(),
        email: email.trim(),
        projectKeys: list(keys).map((k) => k.toUpperCase()),
        boardIds: list(boards)
          .map(Number)
          .filter((n) => Number.isFinite(n)),
        ...(token ? { apiToken: token } : {}),
      });
      setToken('');
      toast.success('Jira settings saved');
      onSaved();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  // UAT-02: tests what is in the form, saved or not (the saved token is used for the saved site and account).
  const runTest = async () => {
    if (!siteOk()) return;
    setTesting(true);
    try {
      const r = await gaps.integrations.testJira({ siteUrl: site, email, apiToken: token || undefined });
      setTest({ ok: r.ok, message: r.message, field: r.storyPointField });
    } catch (e) {
      setTest({ ok: false, message: errorText(e), field: null });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card
      title="Jira Cloud"
      subtitle={
        initial.lastTestedAt
          ? `Last tested ${formatDate(initial.lastTestedAt)}`
          : 'Story points per tribe, quarter and sprint.'
      }
      actions={
        <StatusPill
          tone={st.tone}
          icon={initial.status === 'connected' ? CircleCheck : initial.status === 'error' ? CircleAlert : SquareKanban}
        >
          {st.label}
        </StatusPill>
      }
      footer={
        manage ? (
          <div className="pcp-settings__footer">
            <Button iconBefore={RefreshCw} loading={testing} onClick={() => void runTest()}>
              Test connection
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="pcp-settings__form">
        {manage && !initial.secretsWritable ? (
          <Banner tone="warning" title="Credentials cannot be saved on this deployment yet.">
            The server has no encryption key for integration secrets (INTEGRATIONS_ENC_KEY). Whoever runs the deployment
            sets it in the hosting environment; see the admin guide. You can still test a connection.
          </Banner>
        ) : null}
        {test ? (
          <Banner tone={test.ok ? 'success' : 'danger'}>
            {test.message}
            {test.field ? (
              <>
                {' '}
                Story points field: <code>{test.field}</code>
              </>
            ) : null}
          </Banner>
        ) : null}
        <div className="pcp-settings__grid-2">
          <FormField label="Site" error={siteError}>
            <TextField
              value={site}
              placeholder="acme.atlassian.net"
              readOnly={!manage}
              onChange={(e) => setSite(e.target.value)}
            />
          </FormField>
          <FormField label="Account email">
            <TextField type="email" value={email} readOnly={!manage} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
        </div>
        {manage ? (
          <FormField
            label="API token"
            help={
              initial.hasSecret
                ? 'Saved. Enter a new token only to replace it.'
                : 'Create one at id.atlassian.com › Security › API tokens.'
            }
          >
            <PasswordField
              value={token}
              autoComplete="off"
              placeholder={initial.hasSecret ? 'Saved' : ''}
              onChange={(e) => setToken(e.target.value)}
            />
          </FormField>
        ) : null}
        <div className="pcp-settings__grid-2">
          <FormField label="Project keys" optional help="Comma-separated, e.g. PAY, LEND.">
            <TextField value={keys} readOnly={!manage} onChange={(e) => setKeys(e.target.value)} />
          </FormField>
          <FormField label="Board IDs" optional help="Comma-separated numbers.">
            <TextField
              value={boards}
              readOnly={!manage}
              inputMode="numeric"
              onChange={(e) => setBoards(e.target.value)}
            />
          </FormField>
        </div>
      </div>
    </Card>
  );
}

function PlanviewCard({
  initial,
  manage,
  gaps,
  toast,
}: {
  initial: PlanviewConnection;
  manage: boolean;
  gaps: Gaps;
  toast: Toast;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [adapter, setAdapter] = useState(initial.adapter);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [username, setUsername] = useState(initial.username);
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<null | { ok: boolean; message: string }>(null);

  const save = async (next = enabled) => {
    setSaving(true);
    try {
      await gaps.integrations.savePlanview({
        enabled: next,
        adapter,
        baseUrl: baseUrl.trim(),
        username: username.trim(),
        ...(secret ? { secret } : {}),
      });
      setSecret('');
      toast.success(next ? 'Planview settings saved' : 'Planview turned off');
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      setTest(await gaps.integrations.testPlanview());
    } catch (e) {
      setTest({ ok: false, message: errorText(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card
      title="Planview (optional)"
      subtitle="Import projects and assignments after reviewing the changes."
      actions={
        <StatusPill tone={enabled ? 'info' : 'neutral'} icon={CalendarRange}>
          {enabled ? 'Enabled' : 'Off'}
        </StatusPill>
      }
      footer={
        manage && enabled ? (
          <div className="pcp-settings__footer">
            <Button iconBefore={PlugZap} loading={testing} onClick={() => void runTest()}>
              Test connection
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="pcp-settings__form">
        <Switch
          checked={enabled}
          disabled={!manage}
          onChange={(on) => {
            setEnabled(on);
            if (!on) void save(false);
          }}
          label="Use Planview"
          description="When off, Planview is hidden everywhere, including Delivery."
        />
        {enabled ? (
          <>
            {test ? <Banner tone={test.ok ? 'success' : 'danger'}>{test.message}</Banner> : null}
            <div className="pcp-settings__grid-2">
              <FormField label="Adapter">
                <Select
                  value={adapter}
                  disabled={!manage}
                  onChange={(e) => setAdapter(e.target.value as PlanviewConnection['adapter'])}
                  options={[
                    { value: 'rest', label: 'REST API' },
                    { value: 'odata', label: 'OData feed' },
                  ]}
                />
              </FormField>
              <FormField label="Base URL">
                <TextField
                  value={baseUrl}
                  placeholder="https://"
                  readOnly={!manage}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </FormField>
              <FormField label="Username">
                <TextField
                  value={username}
                  readOnly={!manage}
                  autoComplete="off"
                  onChange={(e) => setUsername(e.target.value)}
                />
              </FormField>
              {manage ? (
                <FormField
                  label="Secret"
                  help={initial.hasSecret ? 'Saved. Enter a new one only to replace it.' : undefined}
                >
                  <PasswordField
                    value={secret}
                    autoComplete="off"
                    placeholder={initial.hasSecret ? 'Saved' : ''}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                </FormField>
              ) : null}
            </div>
            <p className="pcp-caption pcp-text-tertiary">
              Map Planview fields to planner fields in Delivery › Jira &amp; Planview › Planview.
            </p>
          </>
        ) : null}
      </div>
    </Card>
  );
}
