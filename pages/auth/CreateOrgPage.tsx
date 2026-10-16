import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useSession } from '../../state';
import { Banner, Button, FormField, TextField } from '../../components/ui';
import { useClientGaps } from '../../components/shell/clientGaps';
import { useHomeHref } from '../../components/shell/guards';
import { workspaceBase } from '../../components/shell/workspacePath';
import { AuthForm, AuthLayout, authErrorMessage } from './AuthLayout';

/** `/create` (ST-08): a verified user without an organisation creates it and the first workspace. */
export default function CreateOrgPage() {
  const { me, logout, refreshMe } = useSession();
  const gaps = useClientGaps();
  const navigate = useNavigate();
  const home = useHomeHref();
  const [orgName, setOrgName] = useState('');
  const [wsName, setWsName] = useState('PMO');
  const [errors, setErrors] = useState<{ org?: string; ws?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already in an organisation: go to the workspace (ST-08#AC2).
  if (me?.org && me.workspaces.length > 0 && home && !busy) return <Navigate to={home} replace />;
  if (me && !me.user.emailVerified)
    return <Navigate to={`/verify-email?email=${encodeURIComponent(me.user.email)}`} replace />;

  const submit = async () => {
    const errs: typeof errors = {};
    if (orgName.trim().length < 2) errs.org = 'Enter your organisation name.';
    if (!wsName.trim()) errs.ws = 'Enter a name for the first workspace.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await gaps.account.createOrg({ orgName: orgName.trim(), workspaceName: wsName.trim() });
      await refreshMe();
      navigate(`${workspaceBase(res.orgSlug, res.workspaceId)}/home`, { replace: true });
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Create your organisation"
      subtitle="You'll be its Org Admin. You can invite colleagues and add workspaces later."
      showValue={false}
      footer={
        <Button variant="link" iconBefore={LogOut} onClick={() => void logout().then(() => navigate('/login'))}>
          Sign out
        </Button>
      }
    >
      <AuthForm onSubmit={() => void submit()}>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <FormField label="Organisation name" error={errors.org}>
          <TextField
            size="lg"
            autoComplete="organization"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            data-autofocus=""
          />
        </FormField>
        <FormField
          label="First workspace name"
          error={errors.ws}
          help="A workspace holds one PMO's people, projects and plans."
        >
          <TextField size="lg" value={wsName} onChange={(e) => setWsName(e.target.value)} />
        </FormField>
        <div className="pcp-auth__actions">
          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
            Create
          </Button>
        </div>
      </AuthForm>
    </AuthLayout>
  );
}
