import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Unlink } from 'lucide-react';
import { ROLE_LABEL } from '../../shared/permissions';
import type { InvitationLookup } from '../../shared/contracts/api';
import { useSession } from '../../state';
import {
  Banner,
  Button,
  FormField,
  LinkButton,
  PasswordField,
  Skeleton,
  TextField,
  formatDate,
} from '../../components/ui';
import { useClientGaps } from '../../components/shell/clientGaps';
import { useHomeHref } from '../../components/shell/guards';
import { AuthForm, AuthLayout, MIN_PASSWORD, authErrorMessage } from './AuthLayout';

/** `/invite/:token` (AC-05#AC6/#AC7): join an organisation from a single-use link. */
export default function AcceptInvitePage() {
  const { token = '' } = useParams();
  const gaps = useClientGaps();
  const { refreshMe } = useSession();
  const navigate = useNavigate();
  const home = useHomeHref();
  const [state, setState] = useState<{ status: 'loading' | 'invalid' | 'ready'; invite: InvitationLookup | null }>({
    status: 'loading',
    invite: null,
  });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    gaps.auth
      .lookupInvitation(token)
      .then((invite) => alive && setState({ status: 'ready', invite }))
      .catch(() => alive && setState({ status: 'invalid', invite: null }));
    return () => {
      alive = false;
    };
  }, [gaps, token]);

  if (state.status === 'loading') {
    return (
      <AuthLayout title="Checking your invitation" showValue={false}>
        <Skeleton variant="text" lines={4} label="invitation" />
      </AuthLayout>
    );
  }

  if (state.status === 'invalid' || !state.invite) {
    return (
      <AuthLayout
        title="This invitation can't be used"
        showValue={false}
        footer={
          <LinkButton variant="link" to="/login">
            Go to sign in
          </LinkButton>
        }
      >
        <Banner tone="warning" icon={Unlink}>
          This invitation link has expired or was already used. Ask your admin for a new one.
        </Banner>
      </AuthLayout>
    );
  }

  const invite = state.invite;

  if (invite.existingUser) {
    return (
      <AuthLayout title={`Join ${invite.orgName} on PMO Capacity Planner`} showValue={false}>
        <p className="pcp-text-secondary">
          You already have an account for <strong>{invite.email}</strong>. Sign in to accept the invitation.
        </p>
        <div className="pcp-auth__actions">
          <LinkButton
            variant="primary"
            size="lg"
            fullWidth
            to={`/login?email=${encodeURIComponent(invite.email)}&next=${encodeURIComponent(`/invite/${token}`)}`}
          >
            Sign in to accept
          </LinkButton>
        </div>
      </AuthLayout>
    );
  }

  const submit = async () => {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Enter your name.';
    if (password.length < MIN_PASSWORD) errs.password = `Use at least ${MIN_PASSWORD} characters.`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      await gaps.auth.acceptInvitation(token, { name: name.trim(), password });
      await refreshMe();
      navigate(home ?? '/', { replace: true });
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={`Join ${invite.orgName} on PMO Capacity Planner`}
      documentTitle="Accept invitation"
      subtitle={`This invitation expires on ${formatDate(invite.expiresAt)}.`}
      showValue={false}
      footer={
        <span className="pcp-auth__links">
          Not you? <Link to="/login">Sign in with another account</Link>
        </span>
      }
    >
      <AuthForm onSubmit={() => void submit()}>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {invite.workspaces.length ? (
          <Banner tone="info">
            You&apos;ll join{' '}
            {invite.workspaces.map((w, i) => (
              <span key={w.id}>
                {i > 0 ? ', ' : ''}
                <strong>{w.name}</strong> as {ROLE_LABEL[w.role]}
              </span>
            ))}
            .
          </Banner>
        ) : null}
        <FormField label="Email">
          <TextField size="lg" value={invite.email} readOnly />
        </FormField>
        <FormField label="Full name" error={errors.name}>
          <TextField
            size="lg"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-autofocus=""
          />
        </FormField>
        <FormField label="Password" error={errors.password} help={`At least ${MIN_PASSWORD} characters.`}>
          <PasswordField
            size="lg"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <div className="pcp-auth__actions">
          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
            Join {invite.orgName}
          </Button>
        </div>
      </AuthForm>
    </AuthLayout>
  );
}
