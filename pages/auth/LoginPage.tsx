import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ApiRequestError, useSession } from '../../state';
import { Banner, Button, CodeInput, FormField, PasswordField, TextField } from '../../components/ui';
import { SIGNUP_ENABLED } from '../../components/shell/env';
import { safeNext } from '../../components/shell/workspacePath';
import { SessionLoading, useHomeHref } from '../../components/shell/guards';
import { AuthForm, AuthLayout, authErrorMessage, isEmail } from './AuthLayout';

const RESEND_SECONDS = 30;

/**
 * Sign in (ST-07). Uses useSession().login(email, password, otp?) — the same `/api/auth/login` request and
 * response contract as v1.1 (C's transport), so existing users sign in unchanged; 2FA is a second step.
 */
export default function LoginPage() {
  const { status, login } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const home = useHomeHref();
  const next = safeNext(params.get('next'));
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  // Already signed in: go to the deep link or the last workspace (ST-07#AC4).
  if (status === 'loading') return <SessionLoading />;
  if (status === 'authenticated' && !busy) {
    const target = next ?? home;
    if (target) return <Navigate to={target} replace />;
  }

  const finish = () => {
    navigate(next ?? '/', { replace: true });
  };

  const submitCredentials = async () => {
    const errs: typeof fieldErrors = {};
    if (!isEmail(email)) errs.email = 'Enter your work email address.';
    if (!password) errs.password = 'Enter your password.';
    setFieldErrors(errs);
    if (errs.email || errs.password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await login(email.trim(), password);
      if (res.require2FA) {
        setStep('otp');
        setOtp('');
        setResendIn(RESEND_SECONDS);
      } else finish();
    } catch (e) {
      setError(authErrorMessage(e, 'login'));
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (code = otp) => {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password, code);
      finish();
    } catch (e) {
      const invalid = e instanceof ApiRequestError && (e.status === 400 || e.status === 401);
      setError(invalid ? 'That code is not valid or has expired.' : authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setResendIn(RESEND_SECONDS);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(authErrorMessage(e, 'login'));
    }
  };

  const notice =
    params.get('reason') === 'session'
      ? 'Please sign in again.'
      : params.get('reset') === '1'
        ? 'Your password was reset. Sign in with your new password.'
        : params.get('verified') === '1'
          ? 'Your email is verified. Sign in to continue.'
          : null;

  if (step === 'otp') {
    return (
      <AuthLayout
        title="Check your email"
        documentTitle="Verify sign-in"
        subtitle={
          <>
            Enter the 6-digit code we emailed to <strong>{email.trim()}</strong>.
          </>
        }
        showValue={false}
      >
        <AuthForm onSubmit={() => void submitOtp()}>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <div className="pcp-auth__code">
            <CodeInput
              label="Verification code"
              value={otp}
              onChange={setOtp}
              onComplete={(code) => void submitOtp(code)}
              invalid={!!error}
              focusOnMount
            />
          </div>
          <div className="pcp-auth__actions">
            <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
              Verify
            </Button>
            <div className="pcp-auth__row">
              <Button
                variant="link"
                iconBefore={ArrowLeft}
                onClick={() => {
                  setStep('credentials');
                  setError(null);
                }}
              >
                Use a different account
              </Button>
              <Button variant="link" disabled={resendIn > 0} onClick={() => void resend()}>
                {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </Button>
            </div>
          </div>
        </AuthForm>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in to PMO Capacity Planner"
      documentTitle="Sign in"
      footer={
        SIGNUP_ENABLED ? (
          <span className="pcp-auth__links">
            New to PMO Capacity Planner? <Link to="/register">Create account</Link>
          </span>
        ) : null
      }
    >
      <AuthForm onSubmit={() => void submitCredentials()}>
        {notice && !error ? <Banner tone="info">{notice}</Banner> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <FormField label="Email" error={fieldErrors.email}>
          <TextField
            size="lg"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-autofocus=""
          />
        </FormField>
        <FormField
          label="Password"
          error={fieldErrors.password}
          labelAside={
            <Link
              to={`/reset${isEmail(email) ? `?email=${encodeURIComponent(email.trim())}` : ''}`}
              className="pcp-caption"
            >
              Forgot password?
            </Link>
          }
        >
          <PasswordField
            size="lg"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <div className="pcp-auth__actions">
          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
            Sign in
          </Button>
        </div>
      </AuthForm>
    </AuthLayout>
  );
}
